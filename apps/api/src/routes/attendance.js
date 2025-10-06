const router = require("express").Router();
const { auth } = require("../middleware/auth");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Leave = require("../models/Leave");
const Company = require("../models/Company");
const Project = require("../models/Project");
const Task = require("../models/Task");
const AttendanceOverride = require("../models/AttendanceOverride");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const { runAutoPunchOut } = require("../jobs/autoPunchOut");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Build yyyy-mm-dd for server-local date
function dateKeyLocal(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Treat manual time inputs as belonging to a company-configured timezone.
// If ATTENDANCE_TZ_OFFSET_MINUTES is provided (minutes ahead of UTC), use that.
// Otherwise fall back to the host machine's timezone offset for the target date.
const CONFIGURED_ATTENDANCE_OFFSET_MINUTES = (() => {
  const raw = process.env.ATTENDANCE_TZ_OFFSET_MINUTES;
  if (raw === undefined) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
})();

function resolveAttendanceOffsetMinutes(year, month, day) {
  if (CONFIGURED_ATTENDANCE_OFFSET_MINUTES !== null)
    return CONFIGURED_ATTENDANCE_OFFSET_MINUTES;
  // Use midday to avoid DST midnight transitions impacting offset lookup.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return -probe.getTimezoneOffset();
}

function buildUtcDateFromLocal(dateKey, timeValue) {
  if (dateKey === null || dateKey === undefined)
    throw new Error("Invalid date");

  const normalizedDate = String(dateKey).trim();
  const [yearStr, monthStr, dayStr] = normalizedDate.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (![year, month, day].every((n) => Number.isFinite(n)))
    throw new Error("Invalid date");

  if (timeValue === null || timeValue === undefined)
    throw new Error("Invalid time");

  const normalizedTime = String(timeValue).trim();
  const [hhRaw, mmRaw] = normalizedTime.split(":");
  const hours = parseInt(hhRaw, 10);
  const minutes = parseInt(mmRaw, 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23)
    throw new Error("Invalid hours");
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59)
    throw new Error("Invalid minutes");

  const offsetMs = resolveAttendanceOffsetMinutes(year, month, day) * 60000;
  const utcMillis = Date.UTC(year, month - 1, day, hours, minutes);
  return new Date(utcMillis - offsetMs);
}

function isAdminUser(emp) {
  return ["ADMIN", "SUPERADMIN"].includes(emp?.primaryRole);
}

function canManageManualAttendance(emp) {
  if (isAdminUser(emp)) return true;
  return (emp?.subRoles || []).some((r) => ["hr", "manager"].includes(r));
}

const ATTENDANCE_ISSUE_TYPES = {
  AUTO_PUNCH: "autoPunch",
  MISSING_PUNCH_OUT: "missingPunchOut",
  NO_ATTENDANCE: "noAttendance",
};

async function collectAttendanceIssues({
  employeeId,
  start,
  endExclusive,
  employeeDoc,
}) {
  const todayStart = startOfDay(new Date());
  const end = endExclusive ? startOfDay(endExclusive) : todayStart;

  const employee =
    employeeDoc ||
    (await Employee.findById(employeeId)
      .select("company createdAt joiningDate")
      .lean());

  const employmentStartRaw = employee?.joiningDate || employee?.createdAt;
  const employmentStart = employmentStartRaw
    ? startOfDay(employmentStartRaw)
    : null;

  let rangeStart = start ? startOfDay(start) : employmentStart || todayStart;
  if (employmentStart && rangeStart < employmentStart) {
    rangeStart = employmentStart;
  }

  if (!(end > rangeStart)) return [];

  const [records, company, companyOverrides, overrides, leaves] = await Promise.all([
    Attendance.find({
      employee: employeeId,
      date: { $gte: rangeStart, $lt: end },
    })
      .select(
        "date firstPunchIn lastPunchOut autoPunchOut autoPunchOutAt autoPunchLastIn manualFillRequest"
      )
      .lean(),
    employee?.company
      ? Company.findById(employee.company).select("bankHolidays").lean()
      : null,
    employee?.company
      ? CompanyDayOverride.find({
          company: employee.company,
          date: { $gte: rangeStart, $lt: end },
        })
          .select("date type")
          .lean()
      : [],
    AttendanceOverride.find({
      employee: employeeId,
      date: { $gte: rangeStart, $lt: end },
    })
      .select("date ignoreHoliday")
      .lean(),
    Leave.find({
      employee: employeeId,
      status: { $in: ["PENDING", "APPROVED"] },
      startDate: { $lte: end },
      endDate: { $gte: rangeStart },
    })
      .select("startDate endDate status")
      .lean(),
  ]);

  const attendanceByKey = new Map(records.map((r) => [dateKeyLocal(r.date), r]));
  const overrideByKey = new Map(overrides.map((o) => [dateKeyLocal(o.date), o]));
  const companyOverrideByKey = new Map(
    (companyOverrides || []).map((o) => [dateKeyLocal(o.date), o])
  );

  const holidaySet = new Set(
    (company?.bankHolidays || [])
      .filter((h) => h.date >= rangeStart && h.date < end)
      .map((h) => dateKeyLocal(h.date))
  );

  const leaveKeys = new Set();
  for (const leave of leaves) {
    const startDay = leave.startDate < rangeStart ? new Date(rangeStart) : startOfDay(leave.startDate);
    const endBound = leave.endDate >= end ? new Date(end.getTime() - 1) : leave.endDate;
    const endDay = startOfDay(endBound);
    for (let cursor = new Date(startDay); cursor <= endDay; cursor.setDate(cursor.getDate() + 1)) {
      leaveKeys.add(dateKeyLocal(cursor));
    }
  }

  const issues = [];
  for (let cursor = new Date(rangeStart); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const day = startOfDay(cursor);
    if (day >= todayStart) break;
    if (employmentStart && day < employmentStart) continue;

    const key = dateKeyLocal(day);
    const rec = attendanceByKey.get(key);

    const manualReqStatus = rec?.manualFillRequest?.status;
    if (manualReqStatus === "COMPLETED") continue;

    let isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const compOverride = companyOverrideByKey.get(key);
    if (compOverride?.type === "WORKING") isWeekend = false;

    let isHoliday = holidaySet.has(key);
    if (compOverride?.type === "HOLIDAY") {
      isHoliday = true;
      isWeekend = false;
    }

    const override = overrideByKey.get(key);
    if (override?.ignoreHoliday) isHoliday = false;

    if (isWeekend || isHoliday) continue;
    if (leaveKeys.has(key)) continue;

    if (!rec || !rec.firstPunchIn) {
      issues.push({ date: key, type: ATTENDANCE_ISSUE_TYPES.NO_ATTENDANCE });
      continue;
    }

    if (!rec.lastPunchOut) {
      issues.push({ date: key, type: ATTENDANCE_ISSUE_TYPES.MISSING_PUNCH_OUT });
      continue;
    }

    if (rec.autoPunchOut) {
      issues.push({
        date: key,
        type: ATTENDANCE_ISSUE_TYPES.AUTO_PUNCH,
        autoPunchOutAt: rec.autoPunchOutAt
          ? new Date(rec.autoPunchOutAt).toISOString()
          : rec.lastPunchOut
          ? new Date(rec.lastPunchOut).toISOString()
          : undefined,
      });
    }
  }

  return issues;
}

function serializeManualRequest(record) {
  if (!record) return null;
  const reqInfo = record.manualFillRequest || {};
  const employee = record.employee || {};
  const requestedBy = reqInfo.requestedBy || {};
  const resolvedBy = reqInfo.resolvedBy || {};
  const id = record._id || record.id;
  return {
    id: id ? String(id) : null,
    employee: employee
      ? {
          id: employee._id ? String(employee._id) : null,
          name: employee.name || "",
          email: employee.email || "",
        }
      : null,
    date: record.date ? dateKeyLocal(record.date) : null,
    note: reqInfo.note || "",
    adminNote: reqInfo.adminNote || "",
    status: reqInfo.status || "PENDING",
    requestedAt: reqInfo.requestedAt || null,
    acknowledgedAt: reqInfo.acknowledgedAt || null,
    resolvedAt: reqInfo.resolvedAt || null,
    requestedBy: requestedBy._id
      ? {
          id: String(requestedBy._id),
          name: requestedBy.name || "",
          email: requestedBy.email || "",
        }
      : null,
    resolvedBy: resolvedBy._id
      ? {
          id: String(resolvedBy._id),
          name: resolvedBy.name || "",
          email: resolvedBy.email || "",
        }
      : null,
    autoPunchOut: !!record.autoPunchOut,
    autoPunchOutAt: record.autoPunchOutAt || null,
    firstPunchIn: record.firstPunchIn || null,
    lastPunchOut: record.lastPunchOut || null,
    workedMs: record.workedMs || 0,
  };
}

router.post("/punch", auth, async (req, res) => {
  const { action } = req.body;
  if (!["in", "out"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const rawLocation =
    typeof req.body.location === "string" ? req.body.location.trim() : "";
  const locationLabel = rawLocation ? rawLocation.slice(0, 140) : "";

  const today = startOfDay(new Date());

  if (action === "in") {
    const employeeDoc = await Employee.findById(req.employee.id)
      .select("company createdAt joiningDate")
      .lean();
    const fallbackStart = new Date(today);
    fallbackStart.setDate(fallbackStart.getDate() - 365);
    const lookbackStart = employeeDoc?.joiningDate
      ? new Date(employeeDoc.joiningDate)
      : employeeDoc?.createdAt
      ? new Date(employeeDoc.createdAt)
      : fallbackStart;
    const issues = await collectAttendanceIssues({
      employeeId: req.employee.id,
      start: lookbackStart,
      endExclusive: today,
      employeeDoc,
    });
    if (issues.length) {
      const issueCount = issues.length;
      return res.status(409).json({
        error: `You still have ${issueCount} pending attendance ${
          issueCount === 1 ? "issue" : "issues"
        }. Open Resolve Attendance Issues to continue.`,
        issues,
        issueCount,
      });
    }
  }

  let record = await Attendance.findOne({
    employee: req.employee.id,
    date: today,
  });
  const now = new Date();
  if (!record) {
    if (action === "out")
      return res.status(400).json({ error: "Must punch in first" });
    record = await Attendance.create({
      employee: req.employee.id,
      date: today,
      firstPunchIn: now,
      lastPunchIn: now,
      firstPunchInLocation: locationLabel || undefined,
      lastPunchInLocation: locationLabel || undefined,
    });
    return res.json({ attendance: record });
  }

  let didPunchOut = false;
  if (action === "in") {
    if (!record.lastPunchIn) {
      if (!record.firstPunchIn) record.firstPunchIn = now;
      record.lastPunchIn = now;
      record.lastPunchOut = undefined;
    }
    if (locationLabel) {
      if (!record.firstPunchInLocation) {
        record.firstPunchInLocation = locationLabel;
      }
      record.lastPunchInLocation = locationLabel;
    }
  } else {
    if (record.lastPunchIn) {
      record.workedMs += now.getTime() - record.lastPunchIn.getTime();
      record.lastPunchOut = now;
      record.lastPunchIn = undefined;
      didPunchOut = true;
    }
  }
  await record.save();
  res.json({ attendance: record });

  // Fire-and-forget: on punch-out, send daily task summary email to reporting person
  if (didPunchOut) {
    (async () => {
      try {
        const emp = await Employee.findById(req.employee.id)
          .select(
            "name email company reportingPersons reportingPerson"
          )
          .lean();
        if (!emp) return;
        const companyId = emp.company;
        if (!(await isEmailEnabled(companyId))) return;
        const reportingIds = Array.from(
          new Set(
            [
              ...(Array.isArray(emp.reportingPersons)
                ? emp.reportingPersons.map((id) => String(id))
                : []),
              emp.reportingPerson ? String(emp.reportingPerson) : null,
            ].filter(Boolean)
          )
        );
        if (!reportingIds.length) return; // no reporting person configured
        const reportingRecipients = await Employee.find({
          _id: { $in: reportingIds },
        })
          .select("name email")
          .lean();
        const recipientEmails = reportingRecipients
          .map((rp) => rp?.email)
          .filter((email) => typeof email === 'string' && email.trim());
        if (!recipientEmails.length) return;

        // Determine the calendar day for the record
        const dayStart = startOfDay(record.date);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        // Limit to projects within the same company
        const companyProjects = await Project.find({ company: emp.company })
          .select("_id title")
          .lean();
        const projectIds = companyProjects.map((p) => p._id);

        // Tasks worked by this employee on that day
        const rawTasks = await Task.find({
          project: { $in: projectIds },
          timeLogs: {
            $elemMatch: {
              addedBy: req.employee.id,
              createdAt: { $gte: dayStart, $lt: dayEnd },
            },
          },
        })
          .populate("project", "title")
          .select("title status timeLogs project")
          .lean();

        const tasks = rawTasks.map((t) => {
          const logs = (t.timeLogs || []).filter(
            (l) => String(l.addedBy) === String(req.employee.id) && l.createdAt >= dayStart && l.createdAt < dayEnd
          );
          const minutes = logs.reduce((acc, l) => acc + (l.minutes || 0), 0);
          return {
            id: String(t._id),
            title: t.title,
            status: t.status,
            projectTitle: t.project ? t.project.title : "",
            minutes,
            logs: logs.map((l) => ({
              minutes: l.minutes,
              note: l.note,
              createdAt: l.createdAt,
            })),
          };
        });

        // Build email
        const y = dayStart.getFullYear();
        const m = String(dayStart.getMonth() + 1).padStart(2, "0");
        const d = String(dayStart.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;
        const totalMinutes = tasks.reduce((acc, t) => acc + (t.minutes || 0), 0);
        const safe = (s) => (s ? String(s).replace(/</g, "&lt;") : "");

        const rowsHtml = tasks.length
          ? tasks
              .map(
                (t) => `
              <tr>
                <td style="padding:6px 8px; border:1px solid #eee;">${safe(t.projectTitle)}</td>
                <td style="padding:6px 8px; border:1px solid #eee;">${safe(t.title)}</td>
                <td style="padding:6px 8px; border:1px solid #eee; white-space:nowrap;">${Math.round(
                  (t.minutes || 0) / 6
                ) / 10} h</td>
                <td style="padding:6px 8px; border:1px solid #eee; color:#666; font-size:12px;">${
                  (t.logs || [])
                    .filter((l) => l.note)
                    .map((l) => `• ${safe(l.note)}`)
                    .join("<br/>") || ""
                }</td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="4" style="padding:10px; border:1px solid #eee; color:#666;">No tasks logged today.</td></tr>`;

        const html = `
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
            <h2 style="margin:0 0 12px;">Daily Status Report</h2>
            <p style="margin:0 0 4px;"><strong>Employee:</strong> ${safe(emp.name)} &lt;${safe(emp.email)}&gt;</p>
            <p style="margin:0 0 12px;"><strong>Date:</strong> ${dateStr}</p>
            <table style="border-collapse:collapse; width:100%;">
              <thead>
                <tr>
                  <th align="left" style="padding:6px 8px; border:1px solid #eee; background:#f6f6f6;">Project</th>
                  <th align="left" style="padding:6px 8px; border:1px solid #eee; background:#f6f6f6;">Task</th>
                  <th align="left" style="padding:6px 8px; border:1px solid #eee; background:#f6f6f6;">Time</th>
                  <th align="left" style="padding:6px 8px; border:1px solid #eee; background:#f6f6f6;">Notes</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <p style="margin-top:12px;"><strong>Total:</strong> ${Math.round((totalMinutes / 60) * 10) / 10} hours</p>
            <p style="margin-top:16px; color:#666; font-size:12px;">This is an automated notification from HRMS.</p>
          </div>
        `;

        const subject = `Daily Status: ${emp.name} — ${dateStr}`;
        await sendMail({
          companyId,
          to: Array.from(new Set(recipientEmails)),
          subject,
          html,
          text: `Daily Status Report for ${emp.name} on ${dateStr}: Total ${Math.round((totalMinutes / 60) * 10) / 10} hours.`,
        });
      } catch (e) {
        console.warn("[attendance] Failed to send daily status report:", e?.message || e);
      }
    })();
  }
});

router.get("/today", auth, async (req, res) => {
  const today = startOfDay(new Date());
  const record = await Attendance.findOne({
    employee: req.employee.id,
    date: today,
  });
  res.json({ attendance: record });
});

router.get("/history/:employeeId?", auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: "Forbidden" });
  const records = await Attendance.find({ employee: targetId }).sort({
    date: -1,
  });
  res.json({ attendance: records });
});

// Monthly work report for an employee
router.get("/report/:employeeId?", auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: "Forbidden" });

  const { month } = req.query;
  let start;
  if (month) {
    start = startOfDay(new Date(month + "-01"));
  } else {
    const now = new Date();
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const workedDays = await Attendance.countDocuments({
    employee: targetId,
    date: { $gte: start, $lt: end },
  });

  const emp = await Employee.findById(targetId).select("company");
  const company = emp
    ? await Company.findById(emp.company).select("bankHolidays")
    : null;

  // Company-wide day overrides for this month
  const companyOverrides = emp
    ? await CompanyDayOverride.find({
        company: emp.company,
        date: { $gte: start, $lt: end },
      })
        .select("date type")
        .lean()
    : [];
  const companyOvByKey = new Map(
    companyOverrides.map((o) => [dateKeyLocal(o.date), o])
  );

  // Load overrides for this month for the target employee
  const overrides = await AttendanceOverride.find({
    employee: targetId,
    date: { $gte: start, $lt: end },
  })
    .select("date ignoreHoliday")
    .lean();
  const overrideHolidayKeys = new Set(
    overrides
      .filter((o) => o.ignoreHoliday)
      .map((o) => dateKeyLocal(o.date))
  );

  let bankHolidays = (company?.bankHolidays || [])
    .filter((h) => h.date >= start && h.date < end)
    .map((h) => dateKeyLocal(h.date))
    .filter((key) => !overrideHolidayKeys.has(key));
  // Apply company-level overrides: exclude WORKING, include HOLIDAY
  const addHoliday = [];
  const removeHoliday = new Set();
  for (const [key, o] of companyOvByKey) {
    if (o.type === 'WORKING') removeHoliday.add(key);
    if (o.type === 'HOLIDAY') addHoliday.push(key);
  }
  bankHolidays = bankHolidays.filter((k) => !removeHoliday.has(k));
  for (const k of addHoliday) if (!bankHolidays.includes(k)) bankHolidays.push(k);

    const leaves = await Leave.find({
      employee: targetId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    });
  const holidaySet = new Set(
    (company?.bankHolidays || [])
      .map((h) => startOfDay(h.date).getTime())
  );
  const leaveDates = [];
    // Pull attendance records for the window to exclude worked days from leaveDates
    const attRecords = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    })
      .select("date firstPunchIn lastPunchOut workedMs")
      .lean();
    const attendanceKeySet = new Set(attRecords.map((r) => dateKeyLocal(r.date)));

    for (const l of leaves) {
      let s = l.startDate < start ? startOfDay(start) : startOfDay(l.startDate);
      let e =
        l.endDate > end
          ? startOfDay(new Date(end.getTime() - 1))
          : startOfDay(l.endDate);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const dd = new Date(d);
        const day = startOfDay(dd).getTime();
        const key = dateKeyLocal(day);
        // Skip company holidays and weekends; and exclude if attendance exists
        const dow = dd.getDay();
        let isWeekend = dow === 0 || dow === 6;
        const keyStr = dateKeyLocal(dd);
        // Company-level working override lifts weekend treatment
        const co = companyOvByKey.get(keyStr);
        if (co?.type === 'WORKING') isWeekend = false;
        // Company-level holiday override adds holiday treatment
        if (co?.type === 'HOLIDAY') {
          // treat as holiday
          if (attendanceKeySet.has(key)) continue; // worked anyway
          continue; // skip adding to leaveDates since it's a holiday
        }
        // Apply ignoreHoliday override
        if (overrideHolidayKeys.has(key)) {
          // treat as not a holiday
        } else if (holidaySet.has(day) || isWeekend) continue;
        if (attendanceKeySet.has(key)) continue;
        leaveDates.push(key);
      }
    }

  res.json({
    report: {
      workedDays,
      leaveDays: leaveDates.length,
      leaveDates,
      bankHolidays,
    },
  });
});

// Detailed monthly day-by-day report for a selected employee
// Includes every day of the month with punch in/out, time spent and day type
router.get("/monthly/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { month } = req.query; // yyyy-mm
    let start;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    // Load company holidays and approved leaves that overlap this month
    const emp = await Employee.findById(targetId).select("company");
    const company = emp
      ? await Company.findById(emp.company).select("bankHolidays workHours")
      : null;

    // Load company-wide day overrides for the selected month
    const compOverrides = emp
      ? await CompanyDayOverride.find({
          company: emp.company,
          date: { $gte: start, $lt: end },
        })
          .select("date type")
          .lean()
      : [];
    const compOvByKey = new Map(compOverrides.map((o) => [dateKeyLocal(o.date), o]));

    // Load overrides and prepare maps
    const overrides = await AttendanceOverride.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    })
      .select("date ignoreHoliday ignoreHalfDay ignoreLate")
      .lean();
    const overrideByKey = new Map(
      overrides.map((o) => [dateKeyLocal(o.date), o])
    );

    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => dateKeyLocal(h.date))
        .filter((key) => !(overrideByKey.get(key)?.ignoreHoliday))
    );
    // Apply company-level overrides on holidays
    for (const [key, o] of compOvByKey) {
      if (o.type === 'WORKING') bankHolidaySet.delete(key);
      if (o.type === 'HOLIDAY') bankHolidaySet.add(key);
    }

    const leaves = await Leave.find({
      employee: targetId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();
    const approvedLeaveSet = new Set();
    for (const l of leaves) {
      const s = l.startDate < start ? start : startOfDay(l.startDate);
      const e =
        l.endDate > end ? new Date(end.getTime() - 1) : startOfDay(l.endDate);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = dateKeyLocal(d);
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        if (!bankHolidaySet.has(key) && !isWeekend) approvedLeaveSet.add(key);
      }
    }

    // Pull all attendance records for the month
    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();

    const byKey = new Map();
    for (const r of records) {
      const key = dateKeyLocal(r.date);
      byKey.set(key, r);
    }

    const days = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = dateKeyLocal(d);
      const rec = byKey.get(key);
      const dow = d.getDay();
      let isWeekend = dow === 0 || dow === 6;
      const compOv = compOvByKey.get(key);
      if (compOv?.type === 'WORKING') isWeekend = false; // treat as working even if weekend
      // Base flags
      let isHoliday = bankHolidaySet.has(key);
      if (compOv?.type === 'WORKING') isHoliday = false;
      if (compOv?.type === 'HOLIDAY') isHoliday = true;
      const isApprovedLeave = approvedLeaveSet.has(key);
      const inFuture = d > new Date();

      let firstPunchIn = rec?.firstPunchIn ? new Date(rec.firstPunchIn) : null;
      let lastPunchOut = rec?.lastPunchOut ? new Date(rec.lastPunchOut) : null;
      let timeSpentMs = 0;
      if (rec) {
        timeSpentMs = rec.workedMs || 0;
        if (rec.lastPunchIn && !rec.lastPunchOut) {
          const recDay = startOfDay(new Date(rec.date));
          if (recDay.getTime() === startOfDay(now).getTime()) {
            timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
          }
        }
        if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
          timeSpentMs =
            new Date(rec.lastPunchOut).getTime() -
            new Date(rec.firstPunchIn).getTime();
        }
      }

      let dayType = timeSpentMs > 6 * 3600000 ? "FULL_DAY" : "HALF_DAY";

      let status = "";
      if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      else if (rec && timeSpentMs > 0) status = "WORKED";
      else if (isApprovedLeave) status = "LEAVE";
      else if (!rec || timeSpentMs <= 0) status = "LEAVE";
      else status = "WORKED";

      // Leave units: exclude weekends/holidays; count 1 for leave days, 0.5 for half-day work
      let leaveUnit = 0;
      if (!inFuture && !isWeekend && !isHoliday) {
        if (status === "LEAVE") {
          leaveUnit = 1;
        } else if (status === "WORKED" && dayType === "HALF_DAY") {
          leaveUnit = 0.5;
        }
      }
      // If company override marks the day as HALF_DAY (and no attendance), count as 0.5 leave
      if (!inFuture && !isWeekend && !isHoliday && compOv?.type === 'HALF_DAY') {
        if ((!rec || timeSpentMs <= 0) && leaveUnit === 0) {
          status = 'LEAVE';
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      // Compute late and overtime using company work hours (if configured)
      let lateMinutes = 0;
      let overtimeMinutes = 0;
      const wh = company?.workHours || {};
      if (!inFuture && rec && rec.firstPunchIn && (!isWeekend && !isHoliday)) {
        if (typeof wh.start === 'string' && /^\d{2}:\d{2}$/.test(wh.start)) {
          const [sh, sm] = wh.start.split(":").map((x) => parseInt(x, 10));
          const grace = Number.isFinite(wh.graceMinutes) ? wh.graceMinutes : 0;
          const schedStart = new Date(d);
          schedStart.setHours(sh, sm + (grace || 0), 0, 0);
          const fp = new Date(rec.firstPunchIn);
          const diffMs = fp.getTime() - schedStart.getTime();
          if (diffMs > 0) lateMinutes = Math.floor(diffMs / 60000);
        }
      }
      if (!inFuture && rec && rec.lastPunchOut && (!isWeekend && !isHoliday)) {
        if (typeof wh.end === 'string' && /^\d{2}:\d{2}$/.test(wh.end)) {
          const [eh, em] = wh.end.split(":").map((x) => parseInt(x, 10));
          const schedEnd = new Date(d);
          schedEnd.setHours(eh, em, 0, 0);
          const lp = new Date(rec.lastPunchOut);
          const diffMs = lp.getTime() - schedEnd.getTime();
          if (diffMs > 0) overtimeMinutes = Math.floor(diffMs / 60000);
        }
      }

      // Apply per-day overrides
      const ov = overrideByKey.get(key);
      const ignored = { ignoredLate: false, ignoredHalfDay: false, ignoredHoliday: false };
      if (ov?.ignoreHoliday) {
        // Already removed from bankHolidaySet above, but keep marker
        ignored.ignoredHoliday = true;
        isHoliday = false;
        if (status === "HOLIDAY") status = rec && timeSpentMs > 0 ? "WORKED" : ""; // recompute minimal sensible status
      }
      if (ov?.ignoreHalfDay && status === "WORKED" && dayType === "HALF_DAY") {
        dayType = "FULL_DAY";
        // If we flipped to full day, remove the 0.5 leave unit
        if (!inFuture && !isWeekend) {
          totalLeaveUnits -= leaveUnit;
          leaveUnit = 0;
        }
        ignored.ignoredHalfDay = true;
      }
      if (ov?.ignoreLate && lateMinutes > 0) {
        lateMinutes = 0;
        ignored.ignoredLate = true;
      }

      days.push({
        date: key,
        firstPunchIn: firstPunchIn ? firstPunchIn.toISOString() : null,
        lastPunchOut: lastPunchOut ? lastPunchOut.toISOString() : null,
        firstPunchInLocation: rec?.firstPunchInLocation || null,
        lastPunchInLocation: rec?.lastPunchInLocation || null,
        timeSpentMs,
        dayType,
        status,
        isWeekend,
        isHoliday,
        isApprovedLeave,
        leaveUnit,
        lateMinutes,
        overtimeMinutes,
        ...ignored,
      });
    }

    res.json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
        2,
        "0"
      )}`,
      employeeId: String(targetId),
      totalLeaveDays: totalLeaveUnits,
      days,
    });
  } catch (e) {
    console.error("monthly report error", e);
    res.status(500).json({ error: "Failed to build monthly report" });
  }
});

// Excel export for monthly report
router.get("/monthly/:employeeId/excel", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    // Reuse JSON builder via internal fetch to avoid code duplication
    // Build the same data as /monthly
    const { month } = req.query;
    let start;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    // Pull company holidays and approved leaves
    const emp = await Employee.findById(targetId).select("company name");
    const company = emp
      ? await Company.findById(emp.company).select("bankHolidays workHours")
      : null;

    // Load company-wide overrides
    const compOverrides = emp
      ? await CompanyDayOverride.find({
          company: emp.company,
          date: { $gte: start, $lt: end },
        })
          .select("date type")
          .lean()
      : [];
    const compOvByKey = new Map(compOverrides.map((o) => [dateKeyLocal(o.date), o]));

    // Load overrides
    const overrides = await AttendanceOverride.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    })
      .select("date ignoreHoliday ignoreHalfDay ignoreLate")
      .lean();
    const overrideByKey = new Map(
      overrides.map((o) => [dateKeyLocal(o.date), o])
    );

    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => dateKeyLocal(h.date))
        .filter((key) => !(overrideByKey.get(key)?.ignoreHoliday))
    );
    for (const [key, o] of compOvByKey) {
      if (o.type === 'WORKING') bankHolidaySet.delete(key);
      if (o.type === 'HOLIDAY') bankHolidaySet.add(key);
    }
    const leaves = await Leave.find({
      employee: targetId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();
    const approvedLeaveSet = new Set();
    for (const l of leaves) {
      const s = l.startDate < start ? start : startOfDay(l.startDate);
      const e =
        l.endDate > end ? new Date(end.getTime() - 1) : startOfDay(l.endDate);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = dateKeyLocal(d);
        if (!bankHolidaySet.has(key)) approvedLeaveSet.add(key);
      }
    }

    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();
    const byKey = new Map();
    for (const r of records) {
      const key = dateKeyLocal(r.date);
      byKey.set(key, r);
    }

    const rows = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = dateKeyLocal(d);
      const rec = byKey.get(key);
      const dow = d.getDay();
      let isWeekend = dow === 0 || dow === 6;
      const compOv = compOvByKey.get(key);
      if (compOv?.type === 'WORKING') isWeekend = false;
      let isHoliday = bankHolidaySet.has(key);
      const isApprovedLeave = approvedLeaveSet.has(key);

      let timeSpentMs = 0;
      if (rec) {
        timeSpentMs = rec.workedMs || 0;
        if (rec.lastPunchIn && !rec.lastPunchOut) {
          const recDay = startOfDay(new Date(rec.date));
          if (recDay.getTime() === startOfDay(now).getTime()) {
            timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
          }
        }
        if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
          timeSpentMs =
            new Date(rec.lastPunchOut).getTime() -
            new Date(rec.firstPunchIn).getTime();
        }
      }
      let dayType = timeSpentMs > 6 * 3600000 ? "FULL_DAY" : "HALF_DAY";
      const inFuture = d > new Date();
      let status = "";
      if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      // Consider actual worked time first; approved leave should not override presence of work
      else if (rec && timeSpentMs > 0) status = "WORKED";
      else if (isApprovedLeave) status = "LEAVE";
      else if (!rec || timeSpentMs <= 0) status = "LEAVE";
      else status = "WORKED";

      let leaveUnit = 0;
      if (!inFuture && !isWeekend && !isHoliday) {
        if (status === "LEAVE") {
          leaveUnit = 1;
        } else if (status === "WORKED" && dayType === "HALF_DAY") {
          leaveUnit = 0.5;
        }
      }
      if (!inFuture && !isWeekend && !isHoliday && compOv?.type === 'HALF_DAY') {
        if ((!rec || timeSpentMs <= 0) && leaveUnit === 0) {
          status = 'LEAVE';
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      // Compute late and overtime using company work hours (if configured)
      let lateMinutes = 0;
      let overtimeMinutes = 0;
      const wh = company?.workHours || {};
      if (!inFuture && rec && rec.firstPunchIn && (!isWeekend && !isHoliday)) {
        if (typeof wh.start === 'string' && /^\d{2}:\d{2}$/.test(wh.start)) {
          const [sh, sm] = wh.start.split(":").map((x) => parseInt(x, 10));
          const grace = Number.isFinite(wh.graceMinutes) ? wh.graceMinutes : 0;
          const schedStart = new Date(d);
          schedStart.setHours(sh, sm + (grace || 0), 0, 0);
          const fp = new Date(rec.firstPunchIn);
          const diffMs = fp.getTime() - schedStart.getTime();
          if (diffMs > 0) lateMinutes = Math.floor(diffMs / 60000);
        }
      }
      if (!inFuture && rec && rec.lastPunchOut && (!isWeekend && !isHoliday)) {
        if (typeof wh.end === 'string' && /^\d{2}:\d{2}$/.test(wh.end)) {
          const [eh, em] = wh.end.split(":").map((x) => parseInt(x, 10));
          const schedEnd = new Date(d);
          schedEnd.setHours(eh, em, 0, 0);
          const lp = new Date(rec.lastPunchOut);
          const diffMs = lp.getTime() - schedEnd.getTime();
          if (diffMs > 0) overtimeMinutes = Math.floor(diffMs / 60000);
        }
      }

      // Apply overrides
      const ov = overrideByKey.get(key);
      if (ov?.ignoreHoliday) {
        isHoliday = false;
        if (status === "HOLIDAY") status = rec && timeSpentMs > 0 ? "WORKED" : "";
      }
      if (ov?.ignoreHalfDay && status === "WORKED" && dayType === "HALF_DAY") {
        dayType = "FULL_DAY";
        if (!inFuture && !isWeekend) {
          totalLeaveUnits -= leaveUnit;
          leaveUnit = 0;
        }
      }
      if (ov?.ignoreLate && lateMinutes > 0) {
        lateMinutes = 0;
      }

      rows.push({
        Date: key,
        "Punch In": rec?.firstPunchIn ? new Date(rec.firstPunchIn) : null,
        "Punch Out": rec?.lastPunchOut ? new Date(rec.lastPunchOut) : null,
        "Punch Location":
          rec?.lastPunchInLocation ||
          rec?.firstPunchInLocation ||
          "",
        "Time Spent (hrs)": Math.round((timeSpentMs / 3600000) * 100) / 100,
        Status:
          status === "WORKED"
            ? dayType === "FULL_DAY"
              ? "Full Day"
              : "Half Day"
            : status,
        "Leave Unit": leaveUnit,
        "Late (mins)": lateMinutes,
        "Overtime (mins)": overtimeMinutes,
      });
    }

    // Build Excel workbook
    const Excel = require("exceljs");
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("Monthly Report");

    ws.columns = [
      { header: "Date", key: "Date", width: 12 },
      { header: "Punch In", key: "Punch In", width: 18 },
      { header: "Punch Out", key: "Punch Out", width: 18 },
      { header: "Punch Location", key: "Punch Location", width: 24 },
      { header: "Time Spent (hrs)", key: "Time Spent (hrs)", width: 18 },
      { header: "Status", key: "Status", width: 16 },
      { header: "Leave Unit", key: "Leave Unit", width: 12 },
      { header: "Late (mins)", key: "Late (mins)", width: 12 },
      { header: "Overtime (mins)", key: "Overtime (mins)", width: 14 },
    ];

    // Add metadata header
    ws.addRow([`Employee: ${emp?.name || targetId}`]);
    const ym = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    ws.addRow([`Month: ${ym}`]);
    ws.addRow([`Total Leave Days: ${totalLeaveUnits}`]);
    ws.addRow([]);

    // Table header row
    ws.addRow(ws.columns.map((c) => c.header));
    ws.getRow(ws.rowCount).font = { bold: true };
    const tableHeaderRow = ws.rowCount; // remember header row index for formatting

    // Data rows
    ws.addRows(
      rows.map((r) => ({
        ...r,
        "Punch In": r["Punch In"] ? new Date(r["Punch In"]) : null,
        "Punch Out": r["Punch Out"] ? new Date(r["Punch Out"]) : null,
      }))
    );

    // Format date/time columns for data rows (after header)
    const firstDataRow = ws.rowCount - rows.length + 1; // header row index + 1
    const dateCol = 1,
      inCol = 2,
      outCol = 3;
    for (let i = firstDataRow; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const dCell = r.getCell(dateCol);
      const inCell = r.getCell(inCol);
      const outCell = r.getCell(outCol);
      dCell.numFmt = "@";
      if (inCell.value) inCell.numFmt = "h:mm AM/PM";
      if (outCell.value) outCell.numFmt = "h:mm AM/PM";
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendance-${(emp?.name || "employee").replace(
        /\s+/g,
        "_"
      )}-${ym}.xlsx`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("monthly excel error", e);
    res.status(500).json({ error: "Failed to export excel" });
  }
});

router.get("/company/today", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const today = startOfDay(new Date());
  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: "EMPLOYEE",
  }).select("_id name");
  const records = await Attendance.find({
    employee: { $in: employees.map((u) => u._id) },
    date: today,
  });

  const attendance = employees.map((u) => {
    const record = records.find(
      (r) => r.employee.toString() === u._id.toString()
    );
    return {
      employee: { id: u._id, name: u.name },
      firstPunchIn: record?.firstPunchIn,
      lastPunchOut: record?.lastPunchOut,
      firstPunchInLocation: record?.firstPunchInLocation,
      lastPunchInLocation: record?.lastPunchInLocation,
    };
  });

  res.json({ attendance });
});

router.get("/company/history", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const { month } = req.query;
  let start;
  if (month) {
    start = startOfDay(new Date(month + "-01"));
  } else {
    const now = new Date();
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: "EMPLOYEE",
  }).select("_id name");
  const records = await Attendance.find({
    employee: { $in: employees.map((u) => u._id) },
    date: { $gte: start, $lt: end },
  });

  const attendance = records.map((r) => {
    const emp = employees.find(
      (u) => u._id.toString() === r.employee.toString()
    );
    return {
      employee: { id: emp?._id, name: emp?.name },
      date: r.date,
      firstPunchIn: r.firstPunchIn,
      lastPunchOut: r.lastPunchOut,
      workedMs: r.workedMs,
      firstPunchInLocation: r.firstPunchInLocation,
      lastPunchInLocation: r.lastPunchInLocation,
    };
  });

  res.json({ attendance });
});

router.get("/company/report", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const { month } = req.query;
  let start;
  if (month) {
    start = startOfDay(new Date(month + "-01"));
  } else {
    const now = new Date();
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: "EMPLOYEE",
  }).select("_id name");

  const counts = await Attendance.aggregate([
    {
      $match: {
        employee: { $in: employees.map((u) => u._id) },
        date: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: "$employee", workedDays: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.workedDays]));

  const company = await Company.findById(req.employee.company).select(
    "bankHolidays"
  );

  const report = [];
  for (const emp of employees) {
    const leaves = await Leave.find({
      employee: emp._id,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    });

    // Attendance keys for this employee (exclude days with attendance from leave count)
    const att = await Attendance.find({
      employee: emp._id,
      date: { $gte: start, $lt: end },
    })
      .select("date")
      .lean();
    const attSet = new Set(att.map((r) => dateKeyLocal(r.date)));

    let leaveDays = 0;
    for (const l of leaves) {
      const s = l.startDate < start ? start : new Date(l.startDate);
      const e = l.endDate > end ? end : new Date(l.endDate);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = dateKeyLocal(d);
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = (company?.bankHolidays || []).some(
          (h) => dateKeyLocal(h.date) === key
        );
        if (isWeekend || isHoliday) continue;
        if (attSet.has(key)) continue;
        leaveDays += 1;
      }
    }

    report.push({
      employee: { id: emp._id, name: emp.name },
      workedDays: countMap.get(String(emp._id)) || 0,
      leaveDays,
    });
  }

  res.json({ report });
});

router.get("/manual-requests", auth, async (req, res) => {
  try {
    if (!canManageManualAttendance(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const rawStatuses = String(req.query.status || "PENDING,ACKED")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const allowedStatuses = [
      "PENDING",
      "ACKED",
      "COMPLETED",
      "CANCELLED",
    ];
    const statuses = rawStatuses.length
      ? rawStatuses.filter((s) => allowedStatuses.includes(s))
      : ["PENDING", "ACKED"];

    const records = await Attendance.find({
      "manualFillRequest.status": { $in: statuses },
    })
      .populate("employee", "name email company")
      .populate("manualFillRequest.requestedBy", "name email")
      .populate("manualFillRequest.resolvedBy", "name email")
      .lean();

    const companyId = String(req.employee.company);
    const requests = records
      .filter(
        (rec) =>
          rec?.employee?.company &&
          String(rec.employee.company) === companyId
      )
      .map((rec) => serializeManualRequest(rec))
      .sort((a, b) => {
        const aTime = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
        const bTime = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
        return aTime - bTime;
      });

    res.json({ requests });
  } catch (e) {
    console.error("manual-requests list error", e);
    res.status(500).json({ error: "Failed to load manual attendance requests" });
  }
});

router.post("/manual-request/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canManage =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canManage)
      return res.status(403).json({ error: "Forbidden" });

    const { date, note } = req.body || {};
    if (!date) return res.status(400).json({ error: "Missing date" });
    const day = startOfDay(new Date(date));
    if (isNaN(day.getTime()))
      return res.status(400).json({ error: "Invalid date" });

    const today = startOfDay(new Date());
    if (!(day < today))
      return res
        .status(400)
        .json({ error: "Manual attendance requests are only allowed for past dates" });

    let record = await Attendance.findOne({ employee: targetId, date: day });
    if (record) {
      if (record.firstPunchIn && record.lastPunchOut)
        return res.status(400).json({ error: "Attendance already exists for this day" });
      const status = record.manualFillRequest?.status;
      if (status === "PENDING" || status === "ACKED")
        return res
          .status(400)
          .json({ error: "Manual attendance request already submitted for this day" });
    }

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const issues = await collectAttendanceIssues({
      employeeId: targetId,
      start: day,
      endExclusive: nextDay,
    });
    const missing = issues.some(
      (iss) =>
        iss.date === dateKeyLocal(day) && iss.type === ATTENDANCE_ISSUE_TYPES.NO_ATTENDANCE
    );
    if (!missing)
      return res
        .status(400)
        .json({ error: "No missing attendance detected for the selected day" });

    if (!record) {
      record = new Attendance({ employee: targetId, date: day });
    }

    record.manualFillRequest = {
      requestedBy: req.employee.id,
      requestedAt: new Date(),
      status: "PENDING",
      note: typeof note === "string" ? note : undefined,
      resolvedAt: undefined,
      resolvedBy: undefined,
    };
    if (!record.isNew) record.markModified("manualFillRequest");
    await record.save();

    const saved = await Attendance.findById(record._id).lean();

    try {
      const employee = await Employee.findById(targetId)
        .select("name email company reportingPerson")
        .lean();
      const companyId = employee?.company;
      if (companyId && (await isEmailEnabled(companyId))) {
        const admins = await Employee.find({
          company: companyId,
          $or: [
            { primaryRole: { $in: ["ADMIN", "SUPERADMIN"] } },
            { subRoles: { $in: ["hr"] } },
          ],
        })
          .select("name email")
          .lean();

        const recipients = new Set();
        for (const adm of admins) if (adm?.email) recipients.add(adm.email);

        if (employee?.reportingPerson) {
          const rp = await Employee.findById(employee.reportingPerson)
            .select("email")
            .lean();
          if (rp?.email) recipients.add(rp.email);
        }

        const requester = await Employee.findById(req.employee.id)
          .select("name email")
          .lean();

        if (recipients.size) {
          const to = Array.from(recipients);
          const dateLabel = dateKeyLocal(day);
          const employeeName = employee?.name || "An employee";
          const requesterName = requester?.name || req.employee.name || employeeName;
          const requesterEmail = requester?.email || req.employee.email || employee?.email || "";
          const cleanNote = typeof note === "string" && note.trim() ? note.trim() : null;

          const subject = `Manual attendance request: ${employeeName} — ${dateLabel}`;
          const textParts = [
            `${employeeName} requested manual attendance entry for ${dateLabel}.`,
            `Requested by: ${requesterName}${requesterEmail ? ` <${requesterEmail}>` : ""}`,
          ];
          if (cleanNote) textParts.push(`Note: ${cleanNote}`);

          const htmlLines = [
            `<p><strong>${employeeName}</strong> requested manual attendance entry for <strong>${dateLabel}</strong>.</p>`,
            `<p>Requested by: <strong>${requesterName}</strong>${
              requesterEmail ? ` &lt;${requesterEmail}&gt;` : ""
            }</p>`,
          ];
          if (cleanNote)
            htmlLines.push(
              `<p><strong>Note:</strong> ${cleanNote.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
            );

          await sendMail({
            companyId,
            to,
            subject,
            text: textParts.join("\n"),
            html: htmlLines.join(""),
          });
        }
      }
    } catch (mailErr) {
      console.warn("[attendance] Failed to send manual request email:", mailErr?.message || mailErr);
    }

    res.json({ attendance: saved });
  } catch (e) {
    console.error("manual-request error", e);
    res.status(500).json({ error: "Failed to request manual attendance entry" });
  }
});

router.patch("/manual-request/:attendanceId/status", auth, async (req, res) => {
  try {
    if (!canManageManualAttendance(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const { attendanceId } = req.params;
    const { status, adminNote } = req.body || {};
    const allowed = ["PENDING", "ACKED", "CANCELLED"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const record = await Attendance.findById(attendanceId)
      .populate("employee", "company")
      .populate("manualFillRequest.requestedBy", "name email")
      .populate("manualFillRequest.resolvedBy", "name email");
    if (!record) return res.status(404).json({ error: "Manual request not found" });
    if (
      !record.employee ||
      String(record.employee.company) !== String(req.employee.company)
    )
      return res.status(403).json({ error: "Forbidden" });

    record.manualFillRequest = record.manualFillRequest || {
      requestedBy: req.employee.id,
      requestedAt: new Date(),
    };
    record.manualFillRequest.status = status;
    if (typeof adminNote === "string")
      record.manualFillRequest.adminNote = adminNote;

    if (status === "ACKED") {
      record.manualFillRequest.acknowledgedAt = new Date();
    } else if (status === "PENDING") {
      record.manualFillRequest.acknowledgedAt = undefined;
    }

    if (status === "CANCELLED") {
      record.manualFillRequest.resolvedAt = new Date();
      record.manualFillRequest.resolvedBy = req.employee.id;
    } else if (status === "PENDING") {
      record.manualFillRequest.resolvedAt = undefined;
      record.manualFillRequest.resolvedBy = undefined;
    }

    await record.save();
    const refreshed = await Attendance.findById(attendanceId)
      .populate("employee", "name email company")
      .populate("manualFillRequest.requestedBy", "name email")
      .populate("manualFillRequest.resolvedBy", "name email")
      .lean();
    res.json({ request: serializeManualRequest(refreshed) });
  } catch (e) {
    console.error("manual-request status error", e);
    res
      .status(500)
      .json({ error: "Failed to update manual attendance request status" });
  }
});

router.post("/manual-request/:attendanceId/resolve", auth, async (req, res) => {
  try {
    if (!canManageManualAttendance(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const { attendanceId } = req.params;
    const record = await Attendance.findById(attendanceId)
      .populate("employee", "company")
      .populate("manualFillRequest.requestedBy", "name email")
      .populate("manualFillRequest.resolvedBy", "name email");
    if (!record) return res.status(404).json({ error: "Manual request not found" });
    if (
      !record.employee ||
      String(record.employee.company) !== String(req.employee.company)
    )
      return res.status(403).json({ error: "Forbidden" });

    const { firstPunchIn, lastPunchOut, breakMinutes, totalMinutes, adminNote } =
      req.body || {};

    if (!firstPunchIn && !record.firstPunchIn)
      return res
        .status(400)
        .json({ error: "Missing first punch-in time" });
    if (!lastPunchOut && !record.lastPunchOut)
      return res.status(400).json({ error: "Missing last punch-out time" });

    const dateKey = dateKeyLocal(record.date);
    const parseTime = (value) => {
      if (!value && value !== 0) return null;
      return buildUtcDateFromLocal(dateKey, value);
    };

    let firstIn = record.firstPunchIn || null;
    let lastOut = record.lastPunchOut || null;

    try {
      if (firstPunchIn) firstIn = parseTime(firstPunchIn);
      if (lastPunchOut) lastOut = parseTime(lastPunchOut);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message || "Invalid time" });
    }

    if (!firstIn || !lastOut)
      return res
        .status(400)
        .json({ error: "Punch-in and punch-out times are required" });
    if (!(lastOut > firstIn))
      return res
        .status(400)
        .json({ error: "Punch-out must be after punch-in" });

    let workedMinutes = Math.max(
      0,
      Math.round((lastOut.getTime() - firstIn.getTime()) / 60000)
    );
    if (breakMinutes !== undefined) {
      const breakM = parseInt(breakMinutes, 10);
      if (!isFinite(breakM) || breakM < 0)
        return res.status(400).json({ error: "Invalid breakMinutes" });
      workedMinutes = Math.max(0, workedMinutes - breakM);
    }
    if (totalMinutes !== undefined) {
      const total = parseInt(totalMinutes, 10);
      if (!isFinite(total) || total < 0)
        return res.status(400).json({ error: "Invalid totalMinutes" });
      workedMinutes = total;
    }

    record.firstPunchIn = firstIn;
    record.lastPunchIn = undefined;
    record.lastPunchOut = lastOut;
    record.workedMs = workedMinutes * 60000;
    record.autoPunchOut = false;
    record.autoPunchOutAt = undefined;
    record.autoPunchLastIn = undefined;
    record.autoPunchResolvedAt = new Date();

    record.manualFillRequest = record.manualFillRequest || {
      requestedBy: req.employee.id,
      requestedAt: new Date(),
    };
    record.manualFillRequest.status = "COMPLETED";
    record.manualFillRequest.resolvedAt = new Date();
    record.manualFillRequest.resolvedBy = req.employee.id;
    record.manualFillRequest.acknowledgedAt =
      record.manualFillRequest.acknowledgedAt || new Date();
    if (typeof adminNote === "string")
      record.manualFillRequest.adminNote = adminNote;

    await record.save();
    const refreshed = await Attendance.findById(attendanceId)
      .populate("employee", "name email company")
      .populate("manualFillRequest.requestedBy", "name email")
      .populate("manualFillRequest.resolvedBy", "name email")
      .lean();
    res.json({ request: serializeManualRequest(refreshed) });
  } catch (e) {
    console.error("manual-request resolve error", e);
    res
      .status(500)
      .json({ error: "Failed to resolve manual attendance request" });
  }
});

router.post("/resolve/leave", auth, async (req, res) => {
  try {
    const { date, endDate, type, reason, employeeId } = req.body || {};
    if (!date) return res.status(400).json({ error: "Missing start date" });

    const targetId = employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    if (!isSelf && !canManageManualAttendance(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const start = startOfDay(new Date(date));
    if (isNaN(start.getTime()))
      return res.status(400).json({ error: "Invalid start date" });

    let end = endDate ? startOfDay(new Date(endDate)) : start;
    if (isNaN(end.getTime()))
      return res.status(400).json({ error: "Invalid end date" });
    if (!(end >= start))
      return res
        .status(400)
        .json({ error: "End date must be on or after start date" });

    const employee = await Employee.findById(targetId).select("company");
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const overlap = await Leave.findOne({
      employee: targetId,
      status: { $in: ["PENDING", "APPROVED"] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    });
    if (overlap)
      return res
        .status(400)
        .json({ error: "Leave already exists overlapping the selected dates" });

    const leave = await Leave.create({
      employee: targetId,
      company: employee.company,
      approver: req.employee.id,
      type: type || "PAID",
      startDate: start,
      endDate: end,
      reason: typeof reason === "string" ? reason : undefined,
      status: "APPROVED",
    });

    // If a manual attendance request exists for any day in range, mark it completed
    const attendanceRecords = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lte: end },
    });
    for (const record of attendanceRecords) {
      if (record.manualFillRequest) {
        record.manualFillRequest.status = "COMPLETED";
        record.manualFillRequest.resolvedAt = new Date();
        record.manualFillRequest.resolvedBy = req.employee.id;
        await record.save();
      }
    }

    res.json({ leave });
  } catch (e) {
    console.error("resolve-leave error", e);
    res.status(500).json({ error: "Failed to apply leave" });
  }
});

// List days in a month where an employee punched in but did not punch out
// GET /attendance/missing-out/:employeeId?  (self or hr/manager/admin)
// Optional query: ?month=yyyy-mm (defaults to current month)
router.get("/missing-out/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { month, scope } = req.query; // scope=all to fetch from employment start
    let start;
    let end;
    let employeeDoc = null;

    if (scope === "all") {
      employeeDoc = await Employee.findById(targetId)
        .select("company createdAt joiningDate")
        .lean();
      const employmentStartRaw =
        employeeDoc?.joiningDate || employeeDoc?.createdAt;
      const employmentStart = employmentStartRaw
        ? startOfDay(employmentStartRaw)
        : startOfDay(new Date());
      start = employmentStart;
      end = startOfDay(new Date());
    } else if (month) {
      start = startOfDay(new Date(month + "-01"));
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    }

    const issues = await collectAttendanceIssues({
      employeeId: targetId,
      start,
      endExclusive: end,
      employeeDoc,
    });
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    res.json({
      employeeId: String(targetId),
      month: monthKey,
      days: issues.map((i) => i.date),
      issues,
    });
  } catch (e) {
    console.error("missing-out error", e);
    res.status(500).json({ error: "Failed to list missing punch-outs" });
  }
});

// Manually set punch-out time for a specific day (self or admin/hr/manager)
// Body: { date: 'yyyy-mm-dd', time: 'HH:mm' }
router.post("/punchout-at/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canEditOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canEditOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { date, time } = req.body || {};
    if (!date || !time) return res.status(400).json({ error: "Missing date or time" });

    const day = startOfDay(new Date(date));
    if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

    // Compose punch-out timestamp in server-local time on that day
    let out;
    try {
      out = buildUtcDateFromLocal(date, time);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr?.message || "Invalid time" });
    }

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    if (!(out >= day && out < nextDay))
      return res.status(400).json({ error: "Time not within selected day" });

    const record = await Attendance.findOne({ employee: targetId, date: day });
    if (!record) return res.status(404).json({ error: "Attendance record not found" });

    const isAuto = !!record.autoPunchOut;
    if (record.lastPunchOut && !isAuto)
      return res.status(400).json({ error: "Already punched out for this day" });

    // Determine the start of the open interval to close. Prefer stored auto punch start,
    // otherwise use the latest punch-in; fall back to the first punch-in if needed.
    const openStart = record.autoPunchLastIn || record.lastPunchIn || record.firstPunchIn;
    if (!openStart)
      return res.status(400).json({ error: "No punch-in found for this day" });

    const lastIn = new Date(openStart);
    if (!(out > lastIn))
      return res
        .status(400)
        .json({ error: "Punch-out must be after last punch-in" });

    let baseWorked = record.workedMs || 0;
    if (isAuto) {
      const priorOut = record.autoPunchOutAt || record.lastPunchOut;
      if (priorOut && priorOut > lastIn) {
        const prevInterval = priorOut.getTime() - lastIn.getTime();
        baseWorked = Math.max(0, baseWorked - prevInterval);
      }
    }

    record.workedMs = baseWorked + (out.getTime() - lastIn.getTime());
    record.lastPunchOut = out;
    record.lastPunchIn = undefined;

    if (isAuto) {
      record.autoPunchOut = false;
      record.autoPunchResolvedAt = new Date();
      record.autoPunchOutAt = out;
      record.autoPunchLastIn = undefined;
    }

    if (record.manualFillRequest) {
      record.manualFillRequest.status = "COMPLETED";
      record.manualFillRequest.resolvedAt = new Date();
      record.manualFillRequest.resolvedBy = req.employee.id;
    }

    await record.save();

    res.json({ attendance: record });
  } catch (e) {
    console.error("punchout-at error", e);
    res.status(500).json({ error: "Failed to set punch-out time" });
  }
});

// Admin/HR/Manager: Trigger auto-punchout job immediately (for testing or recovery)
router.post("/admin/auto-punchout/run", auth, async (req, res) => {
  try {
    const canRun =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!canRun) return res.status(403).json({ error: "Forbidden" });

    const result = await runAutoPunchOut();
    res.json({ ok: true, result });
  } catch (e) {
    console.error("auto-punchout run error", e);
    res.status(500).json({ error: "Failed to run auto-punchout" });
  }
});

// Admin/HR/Manager: Upsert per-day overrides (ignore half-day/late/holiday)
// Body: { date: 'yyyy-mm-dd', ignoreHalfDay?: boolean, ignoreLate?: boolean, ignoreHoliday?: boolean, reason?: string }
router.post("/overrides/:employeeId", auth, async (req, res) => {
  try {
    const canEdit =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!canEdit) return res.status(403).json({ error: "Forbidden" });

    const targetId = req.params.employeeId;
    const { date, ignoreHalfDay, ignoreLate, ignoreHoliday, reason } = req.body || {};
    if (!targetId) return res.status(400).json({ error: "Missing employeeId" });
    if (!date) return res.status(400).json({ error: "Missing date" });
    const day = startOfDay(new Date(date));
    if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

    const update = { updatedBy: req.employee.id };
    if (typeof ignoreHalfDay === 'boolean') update.ignoreHalfDay = !!ignoreHalfDay;
    if (typeof ignoreLate === 'boolean') update.ignoreLate = !!ignoreLate;
    if (typeof ignoreHoliday === 'boolean') update.ignoreHoliday = !!ignoreHoliday;
    if (typeof reason === 'string') update.reason = reason;

    const override = await AttendanceOverride.findOneAndUpdate(
      { employee: targetId, date: day },
      { $setOnInsert: { employee: targetId, date: day }, $set: update },
      { upsert: true, new: true }
    );
    res.json({ override });
  } catch (e) {
    console.error("override upsert error", e);
    res.status(500).json({ error: "Failed to save override" });
  }
});

module.exports = router;
