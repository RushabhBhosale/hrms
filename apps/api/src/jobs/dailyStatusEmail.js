const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Company = require("../models/Company");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const { ensureCompanyRoleDefaults } = require("../utils/permissions");

const DEFAULT_TZ = process.env.DAILY_STATUS_TZ || "Asia/Kolkata";
const DAY_OFFSET = Number(process.env.DAILY_STATUS_DAY_OFFSET || 0); // 0 => today, 1 => yesterday

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

function formatDateKey(date, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\//g, "-");
}

function formatTime(value, timeZone = DEFAULT_TZ) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms = 0) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function computeWorkedMs(rec) {
  if (!rec) return 0;
  if (Number.isFinite(rec.workedMs)) return rec.workedMs;
  if (rec.firstPunchIn && rec.lastPunchOut) {
    return Math.max(
      0,
      new Date(rec.lastPunchOut).getTime() -
        new Date(rec.firstPunchIn).getTime()
    );
  }
  return 0;
}

async function runDailyStatusEmailJob(options = {}) {
  const disableFlag = String(process.env.DISABLE_DAILY_STATUS_MAIL || "")
    .trim()
    .toLowerCase();
  const enableFlag = String(process.env.ENABLE_DAILY_STATUS_MAIL || "")
    .trim()
    .toLowerCase();
  const disabled =
    disableFlag === "1" ||
    disableFlag === "true" ||
    enableFlag === "0" ||
    enableFlag === "false";

  if (disabled) {
    console.log("[daily-status] notifications disabled");
    return;
  }
  const source = options.source ? String(options.source) : "default";

  const offset =
    Number.isFinite(options.dayOffset) && options.dayOffset >= 0
      ? options.dayOffset
      : DAY_OFFSET;
  const targetDay = startOfDay(
    options.targetDate ? new Date(options.targetDate) : new Date()
  );
  if (offset) targetDay.setDate(targetDay.getDate() - offset);
  const nextDay = endOfDay(targetDay);

  const employeeFilterIds = Array.isArray(options.employeeIds)
    ? options.employeeIds
        .map((id) => (id ? String(id) : null))
        .filter(Boolean)
    : null;
  const strictEmployeeFilter = options.strictEmployeeFilter === true;
  if (strictEmployeeFilter && (!employeeFilterIds || !employeeFilterIds.length)) {
    console.log("[daily-status] strict employee filter requested but no employee ids provided");
    return;
  }
  if (source === "punchout") {
    if (!strictEmployeeFilter) {
      console.log("[daily-status] punchout dispatch blocked: strict filter is required");
      return;
    }
    if (!employeeFilterIds || employeeFilterIds.length !== 1) {
      console.log("[daily-status] punchout dispatch blocked: exactly one employee id is required");
      return;
    }
  }
  const punchOutEmployeeId =
    source === "punchout" && employeeFilterIds && employeeFilterIds.length === 1
      ? String(employeeFilterIds[0])
      : null;
  const employeeFilterSet = employeeFilterIds
    ? new Set(employeeFilterIds.map((id) => String(id)))
    : null;

  const employees = await Employee.find({
    company: { $exists: true },
    isDeleted: { $ne: true },
    ...(employeeFilterIds ? { _id: { $in: employeeFilterIds } } : {}),
  })
    .select(
      "_id name email employeeId company primaryRole reportingPerson reportingPersons isActive"
    )
    .lean();

  if (!employees.length) {
    console.log("[daily-status] no employees found");
    return;
  }

  const attendance = await Attendance.find({
    employee: { $in: employees.map((e) => e._id) },
    date: { $gte: targetDay, $lt: nextDay },
  })
    .select(
      "employee firstPunchIn lastPunchOut lastPunchIn workedMs autoPunchOut autoPunchOutAt"
    )
    .lean();

  const attendanceByEmp = new Map(
    attendance.map((a) => [String(a.employee), a])
  );

  // Group employees by company for targeted emails/transports
  const companyGroups = new Map();
  for (const emp of employees) {
    const key = String(emp.company);
    if (!companyGroups.has(key)) {
      companyGroups.set(key, { employees: [] });
    }
    companyGroups.get(key).employees.push(emp);
  }

  for (const [companyId, group] of companyGroups.entries()) {
    // Check permission toggle from role settings (daily_status.send)
    const company = await Company.findById(companyId).select(
      "roleSettings roles roleSettings"
    );
    if (company) {
      const changed = ensureCompanyRoleDefaults(company);
      if (changed) await company.save();
    }
    const roleSettings = company?.roleSettings || {};
    const allowSend = Object.values(roleSettings).some(
      (r) => r?.modules?.daily_status?.send
    );
    if (!allowSend) {
      console.log(
        `[daily-status] company=${companyId} skipped (daily_status.send disabled)`
      );
      continue;
    }

    // Preload company projects for task lookup (filter to target employees if provided)
    const projects = await Project.find({ company: companyId })
      .select("_id title")
      .lean();
    const projectIds = projects.map((p) => p._id);

    // Build task summaries for the day per employee
    const taskMap = new Map();
    if (projectIds.length) {
      const rawTasks = await Task.find({
        project: { $in: projectIds },
        timeLogs: {
          $elemMatch: { createdAt: { $gte: targetDay, $lt: nextDay } },
        },
      })
        .populate("project", "title")
        .select("title timeLogs project")
        .lean();

      rawTasks.forEach((t) => {
        const dayLogs = (t.timeLogs || []).filter(
          (l) =>
            l.createdAt >= targetDay &&
            l.createdAt < nextDay &&
            (!employeeFilterIds || employeeFilterIds.includes(String(l.addedBy)))
        );
        if (!dayLogs.length) return;
        const byEmployee = new Map();
        dayLogs.forEach((log) => {
          const key = String(log.addedBy);
          const prev = byEmployee.get(key) || 0;
          byEmployee.set(key, prev + (log.minutes || 0));
        });
        byEmployee.forEach((minutes, empId) => {
          if (!minutes) return;
          const list = taskMap.get(empId) || [];
          list.push({
            title: t.title || "Task",
            projectTitle:
              (t.project && t.project.title) || "Project",
            minutes,
          });
          taskMap.set(empId, list);
        });
      });

      // Sort each employee's tasks by minutes desc (include all)
      for (const [empId, list] of taskMap.entries()) {
        const sorted = list
          .slice()
          .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
        taskMap.set(empId, sorted);
      }
    }

    const empMap = new Map(group.employees.map((e) => [String(e._id), e]));
    const includeAdminRecipients = source !== "punchout";
    const adminRecipients = includeAdminRecipients
      ? await Employee.find({
          company: companyId,
          primaryRole: { $in: ["ADMIN", "SUPERADMIN"] },
          isDeleted: { $ne: true },
        })
          .select("_id name email")
          .lean()
      : [];
    const rows = [];

    for (const emp of group.employees) {
      const rec = attendanceByEmp.get(String(emp._id));
      const workedMs = computeWorkedMs(rec);
      const hasIn = !!rec?.firstPunchIn;
      const hasOut = !!rec?.lastPunchOut;
      const open = !!rec?.lastPunchIn && !rec?.lastPunchOut;

      let status = "No punches";
      if (hasIn && hasOut) status = "Present";
      else if (open) status = "Open (not punched out)";
      else if (hasIn) status = "Partial (no punch-out)";
      if (rec?.autoPunchOut) status = "Auto punch-out";

      // Skip sending daily status when the day was closed via inactivity auto punch-out
      if (rec?.autoPunchOut) {
        continue;
      }

      // Skip employees without punch window only when explicitly inactive
      if (emp.isActive === false && !hasIn) continue;

      const tasks = taskMap.get(String(emp._id)) || [];
      const totalTaskMinutes = tasks.reduce(
        (sum, t) => sum + (t.minutes || 0),
        0
      );

      // Skip daily status when no task time was logged (e.g., skip punch-out without logs)
      if (!totalTaskMinutes) continue;

      rows.push({
        empId: String(emp._id),
        name: emp.name,
        employeeId: emp.employeeId || "",
        firstIn: formatTime(rec?.firstPunchIn),
        lastOut: formatTime(rec?.lastPunchOut),
        worked: formatDuration(workedMs),
        status,
        tasks,
      });
    }

    const effectiveRows = employeeFilterSet
      ? rows.filter((r) => employeeFilterSet.has(String(r.empId)))
      : rows;
    const scopedRows = punchOutEmployeeId
      ? effectiveRows.filter((r) => String(r.empId) === punchOutEmployeeId)
      : effectiveRows;

    if (!scopedRows.length) {
      console.log(
        `[daily-status] company=${companyId} no rows for ${formatDateKey(
          targetDay
        )}`
      );
      continue;
    }

    // Build per-recipient bundles (reporting persons get their reports; admins get all)
    const recipientRows = new Map();

    function addRows(recipientId, rowsToAdd) {
      if (!recipientId) return;
      const key = String(recipientId);
      const list = recipientRows.get(key) || [];
      for (const row of rowsToAdd || []) {
        if (!row?.empId) continue;
        const exists = list.some((existingRow) => existingRow.empId === row.empId);
        if (!exists) list.push(row);
      }
      recipientRows.set(key, list);
    }

    for (const r of scopedRows) {
      const emp = empMap.get(r.empId);
      if (!emp) continue;
      if (emp.reportingPerson) addRows(emp.reportingPerson, [r]);
      if (Array.isArray(emp.reportingPersons)) {
        emp.reportingPersons.forEach((id) => addRows(id, [r]));
      }
    }

    // Admins get all rows for scheduled/manual runs, not for punch-out-triggered sends.
    adminRecipients.forEach((a) => addRows(a._id, scopedRows));

    const recipientLookupIds = Array.from(recipientRows.keys());
    if (!recipientLookupIds.length) {
      console.log(
        `[daily-status] company=${companyId} no recipients for ${formatDateKey(
          targetDay
        )}`
      );
      continue;
    }

    // Resolve all recipients from DB so filtered runs still include all reporting persons.
    const recipientDocs = await Employee.find({
      _id: { $in: recipientLookupIds },
      company: companyId,
      isDeleted: { $ne: true },
    })
      .select("_id name email")
      .lean();
    const recipientMap = new Map(
      recipientDocs.map((doc) => [String(doc._id), doc])
    );

    if (!(await isEmailEnabled(companyId))) {
      console.warn(
        `[daily-status] company=${companyId} email disabled; skipping`
      );
      continue;
    }

    const dateKey = formatDateKey(targetDay);
    function buildSummaryPayload(rowsForRecipient, greetingText) {
      const textBlocks = [];
      const htmlBlocks = [];

      for (const r of rowsForRecipient) {
        const totalTaskMinutes = r.tasks.reduce(
          (sum, t) => sum + (t.minutes || 0),
          0
        );

        const textLines = [
          `Employee : ${r.name} (${r.employeeId || "NA"})`,
          `First In : ${r.firstIn}`,
          `Last Out : ${r.lastOut}`,
          `Total Worked : ${r.worked}`,
          "",
          "Tasks:",
        ];
        if (!r.tasks.length) {
          textLines.push("  • No tasks logged");
        } else {
          r.tasks.forEach((t) =>
            textLines.push(
              `  • ${t.title}${t.projectTitle ? ` (${t.projectTitle})` : ""} — ${formatDuration(
                (t.minutes || 0) * 60000
              )}`
            )
          );
        }
        if (r.tasks.length) {
          textLines.push(
            `  Total task time: ${formatDuration(totalTaskMinutes * 60000)}`
          );
        }
        textLines.push("------------------------------");
        textBlocks.push(textLines.join("\n"));

        const taskRows =
          r.tasks.length === 0
            ? `<tr><td colspan="3" style="padding:8px 12px;color:#777;font-size:13px;">No tasks logged</td></tr>`
            : r.tasks
                .map(
                  (t) => `<tr>
                    <td style="padding:8px 12px;border:1px solid #eee;">${t.title}</td>
                    <td style="padding:8px 12px;border:1px solid #eee;">${t.projectTitle || "-"}</td>
                    <td style="padding:8px 12px;border:1px solid #eee;">${formatDuration(
                      (t.minutes || 0) * 60000
                    )}</td>
                  </tr>`
                )
                .join("");
        const totalRow = `<tr>
          <td colspan="2" style="padding:8px 12px;border:1px solid #eee;text-align:right;font-weight:600;">Total</td>
          <td style="padding:8px 12px;border:1px solid #eee;font-weight:600;">${formatDuration(
            totalTaskMinutes * 60000
          )}</td>
        </tr>`;

        htmlBlocks.push(`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#111;margin-bottom:20px;">
          <div style="font-weight:600;margin-bottom:6px;">${r.name}${r.employeeId ? ` (${r.employeeId})` : ""}</div>
          <table style="border-collapse:collapse;min-width:360px;font-size:14px;margin-bottom:12px;">
            <tbody>
              <tr><th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;width:120px;">First In</th><td style="padding:6px 10px;border:1px solid #eee;">${r.firstIn}</td></tr>
              <tr><th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;">Last Out</th><td style="padding:6px 10px;border:1px solid #eee;">${r.lastOut}</td></tr>
              <tr><th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;">Total Worked</th><td style="padding:6px 10px;border:1px solid #eee;">${r.worked}</td></tr>
            </tbody>
          </table>
          <div style="margin:0 0 6px;font-weight:600;">Task Details</div>
          <table style="border-collapse:collapse;min-width:360px;font-size:14px;margin-bottom:8px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;">Task</th>
                <th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;">Project</th>
                <th style="text-align:left;padding:6px 10px;border:1px solid #eee;background:#f8f8f8;">Time</th>
              </tr>
            </thead>
            <tbody>${taskRows}${r.tasks.length ? totalRow : ""}</tbody>
          </table>
        </div>`);
      }

      return {
        text: textBlocks.join("\n\n"),
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#111;">
            <p style="margin:0 0 12px;">${greetingText}</p>
            <p style="margin:0 0 12px;">Here is the daily status report on ${dateKey}:</p>
            ${htmlBlocks.join("<hr style='border:none;border-top:1px solid #eee;margin:12px 0;'>")}
            <p style="margin:12px 0 0;font-size:13px;color:#555;">This report has been generated automatically by the HRMS.</p>
          </div>`,
      };
    }

    if (source === "punchout") {
      const recipientEmails = [];
      const seenEmails = new Set();

      for (const recipientId of recipientRows.keys()) {
        const recipient = recipientMap.get(recipientId);
        if (!recipient || !recipient.email) continue;
        const rowsForRecipient = recipientRows.get(recipientId) || [];
        if (!rowsForRecipient.length) continue;

        const email = String(recipient.email || "").trim();
        if (!email) continue;
        const key = email.toLowerCase();
        if (seenEmails.has(key)) continue;
        seenEmails.add(key);
        recipientEmails.push(email);
      }

      if (!recipientEmails.length) {
        console.log(
          `[daily-status] company=${companyId} no recipient emails for ${dateKey}`
        );
        continue;
      }

      const to = recipientEmails[0];
      const cc = recipientEmails.slice(1);
      const subject = `Daily attendance status — ${dateKey}`;
      const payload = buildSummaryPayload(scopedRows, "Hello,");

      try {
        await sendMail({
          companyId,
          to,
          cc: cc.length ? cc : undefined,
          subject,
          skipInAppNotification: true,
          text: payload.text,
          html: payload.html,
        });
        console.log(
          `[daily-status] sent company=${companyId} recipients=${recipientEmails.length} rows=${scopedRows.length}`
        );
      } catch (err) {
        console.error(
          `[daily-status] failed company=${companyId} consolidated recipients=${recipientEmails.length}`,
          err?.message || err
        );
      }
      continue;
    }

    for (const [recipientId, rowsForRecipient] of recipientRows.entries()) {
      const recipient = recipientMap.get(recipientId);
      if (!recipient || !recipient.email) continue;
      const subject = `Daily attendance status — ${dateKey}`;
      const payload = buildSummaryPayload(
        rowsForRecipient,
        `Hello ${recipient.name || ""},`
      );
      try {
        await sendMail({
          companyId,
          to: recipient.email,
          subject,
          skipInAppNotification: true,
          text: payload.text,
          html: payload.html,
        });
        console.log(
          `[daily-status] sent company=${companyId} recipient=${recipient.email} rows=${rowsForRecipient.length}`
        );
      } catch (err) {
        console.error(
          `[daily-status] failed company=${companyId} recipient=${recipient.email}`,
          err?.message || err
        );
      }
    }
  }
}

module.exports = {
  runDailyStatusEmailJob,
};
