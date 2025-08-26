const router = require('express').Router();
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const { auth } = require('../middleware/auth');
const { requirePrimary } = require('../middleware/roles');

// Employee creates a leave request
router.post('/', auth, async (req, res) => {
  const { startDate, endDate, reason, type } = req.body;
  try {
    const emp = await Employee.findById(req.employee.id);
    if (!emp) return res.status(400).json({ error: 'Employee not found' });
    if (!type) return res.status(400).json({ error: 'Missing type' });
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
router.get('/', auth, async (req, res) => {
  const leaves = await Leave.find({ employee: req.employee.id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Reporting person views assigned leave requests
router.get('/assigned', auth, async (req, res) => {
  const leaves = await Leave.find({ approver: req.employee.id })
    .populate('employee', 'name')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Admin views company leave requests
router.get('/company', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const leaves = await Leave.find({ company: req.employee.company })
    .populate('employee', 'name')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Approve a leave
router.post('/:id/approve', auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: 'Not found' });
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole);
  if (
    String(leave.approver) !== String(req.employee.id) &&
    !isAdmin
  )
    return res.status(403).json({ error: 'Forbidden' });
  const employee = await Employee.findById(leave.employee);
  const days = Math.round((leave.endDate - leave.startDate) / 86400000) + 1;
  const key = leave.type.toLowerCase();
  const remaining = employee.leaveBalances?.[key] || 0;
  if (remaining < days)
    return res.status(400).json({ error: 'Insufficient leave balance' });
  employee.leaveBalances[key] = remaining - days;
  await employee.save();
  leave.status = 'APPROVED';
  leave.adminMessage = req.body.message;
  await leave.save();
  res.json({ leave });
});

// Reject a leave
router.post('/:id/reject', auth, async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ error: 'Not found' });
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole);
  if (
    String(leave.approver) !== String(req.employee.id) &&
    !isAdmin
  )
    return res.status(403).json({ error: 'Forbidden' });
  leave.status = 'REJECTED';
  leave.adminMessage = req.body.message;
  await leave.save();
  res.json({ leave });
});

module.exports = router;
