const router = require('express').Router();
const Leave = require('../models/Leave');
const { auth } = require('../middleware/auth');
const { requirePrimary } = require('../middleware/roles');

// Employee creates a leave request
router.post('/', auth, async (req, res) => {
  const { startDate, endDate, reason } = req.body;
  try {
    const leave = await Leave.create({
      employee: req.employee.id,
      company: req.employee.company,
      startDate,
      endDate,
      reason
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

// Admin views company leave requests
router.get('/company', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const leaves = await Leave.find({ company: req.employee.company })
    .populate('employee', 'name')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ leaves });
});

// Admin approves a leave
router.post('/:id/approve', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const leave = await Leave.findByIdAndUpdate(
    req.params.id,
    { status: 'APPROVED', adminMessage: req.body.message },
    { new: true }
  );
  if (!leave) return res.status(404).json({ error: 'Not found' });
  res.json({ leave });
});

// Admin rejects a leave
router.post('/:id/reject', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const leave = await Leave.findByIdAndUpdate(
    req.params.id,
    { status: 'REJECTED', adminMessage: req.body.message },
    { new: true }
  );
  if (!leave) return res.status(404).json({ error: 'Not found' });
  res.json({ leave });
});

module.exports = router;
