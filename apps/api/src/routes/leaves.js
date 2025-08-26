const router = require("express").Router();
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const { syncLeaveBalances } = require("../utils/leaveBalances");

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Employee creates a leave request
router.post("/", auth, async (req, res) => {
  const { startDate, endDate, reason, type } = req.body;
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
  const holidays = (company?.bankHolidays || []).filter(
    (h) => h.date >= start && h.date <= end
  ).length;
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
