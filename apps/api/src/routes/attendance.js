const router = require("express").Router();
const { auth } = require("../middleware/auth");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Leave = require("../models/Leave");
const Company = require("../models/Company");
const Project = require("../models/Project");
const Task = require("../models/Task");
const { sendMail, isEmailEnabled } = require("../utils/mailer");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.post("/punch", auth, async (req, res) => {
  const { action } = req.body;
  if (!["in", "out"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const today = startOfDay(new Date());
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
        if (!isEmailEnabled()) return;

        // Load employee and reporting person
        const emp = await Employee.findById(req.employee.id)
          .select("name email company reportingPerson")
          .lean();
        if (!emp) return;
        if (!emp.reportingPerson) return; // no reporting person configured
        const rp = await Employee.findById(emp.reportingPerson)
          .select("name email")
          .lean();
        if (!rp?.email) return;

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
          to: rp.email,
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

  const bankHolidays = (company?.bankHolidays || [])
    .filter((h) => h.date >= start && h.date < end)
    .map((h) => startOfDay(h.date).toISOString().slice(0, 10));

  const leaves = await Leave.find({
    employee: targetId,
    status: "APPROVED",
    startDate: { $lte: end },
    endDate: { $gte: start },
  });
  const holidaySet = new Set(
    (company?.bankHolidays || []).map((h) => startOfDay(h.date).getTime())
  );
  const leaveDates = [];
  for (const l of leaves) {
    let s = l.startDate < start ? startOfDay(start) : startOfDay(l.startDate);
    let e =
      l.endDate > end
        ? startOfDay(new Date(end.getTime() - 1))
        : startOfDay(l.endDate);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const day = startOfDay(d).getTime();
      if (!holidaySet.has(day)) {
        leaveDates.push(new Date(day).toISOString().slice(0, 10));
      }
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
      ? await Company.findById(emp.company).select("bankHolidays")
      : null;
    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => startOfDay(h.date).toISOString().slice(0, 10))
    );

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
        const key = startOfDay(d).toISOString().slice(0, 10);
        if (!bankHolidaySet.has(key)) approvedLeaveSet.add(key);
      }
    }

    // Pull all attendance records for the month
    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();

    const byKey = new Map();
    for (const r of records) {
      const key = new Date(r.date).toISOString().slice(0, 10);
      byKey.set(key, r);
    }

    const days = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = new Date(d).toISOString().slice(0, 10);
      const rec = byKey.get(key);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = bankHolidaySet.has(key);
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

      const dayType = timeSpentMs > 6 * 3600000 ? "FULL_DAY" : "HALF_DAY";

      let status = "";
      if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      else if (!rec || timeSpentMs <= 0 || isApprovedLeave) status = "LEAVE";
      else status = "WORKED";

      // Leave units: exclude weekends/holidays; count 1 for no punches, 0.5 for half-day work
      let leaveUnit = 0;
      if (!inFuture && !isWeekend && !isHoliday) {
        if (!rec || timeSpentMs <= 0 || isApprovedLeave) {
          leaveUnit = 1;
        } else if (dayType === "HALF_DAY") {
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      days.push({
        date: key,
        firstPunchIn: firstPunchIn ? firstPunchIn.toISOString() : null,
        lastPunchOut: lastPunchOut ? lastPunchOut.toISOString() : null,
        timeSpentMs,
        dayType,
        status,
        isWeekend,
        isHoliday,
        isApprovedLeave,
        leaveUnit,
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
      ? await Company.findById(emp.company).select("bankHolidays")
      : null;
    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => startOfDay(h.date).toISOString().slice(0, 10))
    );
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
        const key = startOfDay(d).toISOString().slice(0, 10);
        if (!bankHolidaySet.has(key)) approvedLeaveSet.add(key);
      }
    }

    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();
    const byKey = new Map();
    for (const r of records) {
      const key = new Date(r.date).toISOString().slice(0, 10);
      byKey.set(key, r);
    }

    const rows = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = new Date(d).toISOString().slice(0, 10);
      const rec = byKey.get(key);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = bankHolidaySet.has(key);
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
      const dayType = timeSpentMs > 6 * 3600000 ? "FULL_DAY" : "HALF_DAY";
      const inFuture = d > new Date();
      let status = "";
      if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      else if (!rec || timeSpentMs <= 0 || isApprovedLeave) status = "LEAVE";
      else status = "WORKED";

      let leaveUnit = 0;
      if (!inFuture && !isWeekend && !isHoliday) {
        if (!rec || timeSpentMs <= 0 || isApprovedLeave) {
          leaveUnit = 1;
        } else if (dayType === "HALF_DAY") {
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      rows.push({
        Date: key,
        "Punch In": rec?.firstPunchIn ? new Date(rec.firstPunchIn) : null,
        "Punch Out": rec?.lastPunchOut ? new Date(rec.lastPunchOut) : null,
        "Time Spent (hrs)": Math.round((timeSpentMs / 3600000) * 100) / 100,
        Status:
          status === "WORKED"
            ? dayType === "FULL_DAY"
              ? "Full Day"
              : "Half Day"
            : status,
        "Leave Unit": leaveUnit,
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
      { header: "Time Spent (hrs)", key: "Time Spent (hrs)", width: 18 },
      { header: "Status", key: "Status", width: 16 },
      { header: "Leave Unit", key: "Leave Unit", width: 12 },
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

    let leaveDays = 0;
    for (const l of leaves) {
      const s = l.startDate < start ? start : new Date(l.startDate);
      const e = l.endDate > end ? end : new Date(l.endDate);
      const total = Math.round((e - s) / 86400000) + 1;
      const holidays = (company?.bankHolidays || []).filter(
        (h) => h.date >= s && h.date <= e
      ).length;
      leaveDays += Math.max(total - holidays, 0);
    }

    report.push({
      employee: { id: emp._id, name: emp.name },
      workedDays: countMap.get(String(emp._id)) || 0,
      leaveDays,
    });
  }

  res.json({ report });
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

    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
      firstPunchIn: { $exists: true },
      $or: [{ lastPunchOut: { $exists: false } }, { lastPunchOut: null }],
    })
      .select("date firstPunchIn lastPunchIn workedMs autoPunchOut")
      .sort({ date: -1 })
      .lean();

    // Build date-only keys based on server-local date (avoid UTC shift)
    const days = records.map((r) => {
      const d = new Date(r.date);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    });
    res.json({ employeeId: String(targetId), month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, days });
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
    const [hh, mm] = String(time).split(":").map((x) => parseInt(x, 10));
    if (!isFinite(hh) || !isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59)
      return res.status(400).json({ error: "Invalid time" });
    const out = new Date(day);
    out.setHours(hh, mm, 0, 0);

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    if (!(out >= day && out < nextDay))
      return res.status(400).json({ error: "Time not within selected day" });

    const record = await Attendance.findOne({ employee: targetId, date: day });
    if (!record) return res.status(404).json({ error: "Attendance record not found" });
    if (record.lastPunchOut)
      return res.status(400).json({ error: "Already punched out for this day" });

    // Determine the start of the open interval to close. Prefer lastPunchIn;
    // if it's missing but the day has a firstPunchIn, fall back to that.
    const openStart = record.lastPunchIn || record.firstPunchIn;
    if (!openStart)
      return res.status(400).json({ error: "No punch-in found for this day" });

    const lastIn = new Date(openStart);
    if (!(out > lastIn))
      return res
        .status(400)
        .json({ error: "Punch-out must be after last punch-in" });

    record.workedMs = (record.workedMs || 0) + (out.getTime() - lastIn.getTime());
    record.lastPunchOut = out;
    record.lastPunchIn = undefined;
    await record.save();

    res.json({ attendance: record });
  } catch (e) {
    console.error("punchout-at error", e);
    res.status(500).json({ error: "Failed to set punch-out time" });
  }
});

module.exports = router;
