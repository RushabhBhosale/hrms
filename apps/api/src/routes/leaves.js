const router = require("express").Router();
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const { auth } = require("../middleware/auth");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const { requirePrimary } = require("../middleware/roles");
const { syncLeaveBalances } = require("../utils/leaveBalances");
const { sendMail, isEmailEnabled } = require("../utils/mailer");

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Employee creates a leave request
router.post("/", auth, async (req, res) => {
  const { startDate, endDate, reason, type, notify } = req.body;
  try {
    const emp = await Employee.findById(req.employee.id);
    if (!emp) return res.status(400).json({ error: "Employee not found" });
    if (!type) return res.status(400).json({ error: "Missing type" });
    const leave = await Leave.create({
      employee: emp._id,
      company: emp.company,
      approver: emp.reportingPerson,
      type,
      startDate,
      endDate,
      reason,
    });
    res.json({ leave });

    // Fire-and-forget email notifications (do not block response)
    ;(async () => {
      if (!isEmailEnabled()) return;

      try {
        const [approver, company] = await Promise.all([
          emp.reportingPerson ? Employee.findById(emp.reportingPerson).select('name email') : null,
          Company.findById(emp.company).populate('admin', 'name email'),
        ]);

        const recipients = [];
        if (approver?.email) recipients.push(approver.email);
        if (company?.admin?.email) recipients.push(company.admin.email);
        // Optional: additional recipients provided by requester (same company only)
        if (Array.isArray(notify) && notify.length) {
          try {
            const ids = notify
              .map((x) => String(x))
              .filter((x) => x && x.length >= 12);
            if (ids.length) {
              const extras = await Employee.find({ _id: { $in: ids }, company: emp.company }).select('email');
              for (const u of extras) if (u?.email) recipients.push(u.email);
            }
          } catch (_) {
            // ignore extras errors; continue with defaults
          }
        }
        // De-duplicate
        const to = Array.from(new Set(recipients));
        if (to.length === 0) return;

        const fmt = (d) => new Date(d).toISOString().slice(0, 10);
        const sub = `New Leave Request: ${emp.name} (${type}) ${fmt(startDate)} → ${fmt(endDate)}`;
        const html = `
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
            <h2 style="margin:0 0 12px;">New Leave Request</h2>
            <p><strong>Employee:</strong> ${emp.name} &lt;${emp.email}&gt;</p>
            <p><strong>Type:</strong> ${type}</p>
            <p><strong>Period:</strong> ${fmt(startDate)} to ${fmt(endDate)}</p>
            ${reason ? `<p><strong>Reason:</strong> ${String(reason).replace(/</g,'&lt;')}</p>` : ''}
            <p style="margin-top:16px; color:#666; font-size:12px;">This is an automated notification from HRMS.</p>
          </div>
        `;

        await sendMail({ to, subject: sub, html, text: `New leave request by ${emp.name} (${type}) from ${fmt(startDate)} to ${fmt(endDate)}${reason ? `\nReason: ${reason}` : ''}` });
      } catch (e) {
        console.warn('[leaves] Failed to send notification email:', e?.message || e);
      }
    })();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Employee views their leave requests
router.get("/", auth, async (req, res) => {
  const leaves = await Leave.find({ employee: req.employee.id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Reporting person views assigned leave requests
router.get("/assigned", auth, async (req, res) => {
  const leaves = await Leave.find({ approver: req.employee.id })
    .populate("employee", "name")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Admin views company leave requests
router.get(
  "/company",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const leaves = await Leave.find({ company: req.employee.company })
      .populate("employee", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ leaves });
  }
);

// Company leaves happening today
router.get("/company/today", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const today = startOfDay(new Date());
  const leaves = await Leave.find({
    company: req.employee.company,
    status: "APPROVED",
    startDate: { $lte: today },
    endDate: { $gte: today },
  })
    .populate("employee", "name")
    .lean();

  res.json({ leaves });
});

// Approve a leave
router.post("/:id/approve", auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: "Not found" });
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  if (String(leave.approver) !== String(req.employee.id) && !isAdmin)
    return res.status(403).json({ error: "Forbidden" });
  const employee = await Employee.findById(leave.employee);
  await syncLeaveBalances(employee);
  const company = await Company.findById(leave.company).select("bankHolidays");
  const start = new Date(leave.startDate);
  const end = new Date(leave.endDate);
  const total = Math.round((end - start) / 86400000) + 1;
  // Build effective holiday set: bank holidays +/- company overrides
  const bankHolidayKeys = new Set(
    (company?.bankHolidays || [])
      .filter((h) => h.date >= start && h.date <= end)
      .map((h) => new Date(h.date).toISOString().slice(0,10))
  );
  const overrides = await CompanyDayOverride.find({ company: leave.company, date: { $gte: start, $lte: end } })
    .select('date type')
    .lean();
  for (const o of overrides) {
    const key = new Date(o.date).toISOString().slice(0,10);
    if (o.type === 'WORKING') bankHolidayKeys.delete(key);
    if (o.type === 'HOLIDAY') bankHolidayKeys.add(key);
  }
  const holidays = bankHolidayKeys.size;
  const days = Math.max(total - holidays, 0);
  const key = leave.type.toLowerCase();
  const remaining = employee.leaveBalances?.[key] || 0;
  if (remaining < days)
    return res.status(400).json({ error: "Insufficient leave balance" });
  employee.leaveBalances[key] = remaining - days;
  await employee.save();
  leave.status = "APPROVED";
  leave.adminMessage = req.body.message;
  await leave.save();
  res.json({ leave });
});

// Reject a leave
router.post("/:id/reject", auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: "Not found" });
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  if (String(leave.approver) !== String(req.employee.id) && !isAdmin)
    return res.status(403).json({ error: "Forbidden" });
  leave.status = "REJECTED";
  leave.adminMessage = req.body.message;
  await leave.save();
  res.json({ leave });
});

module.exports = router;
