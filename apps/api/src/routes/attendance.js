const router = require('express').Router();
const { auth } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const User = require('../models/User');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.post('/punch', auth, async (req, res) => {
  const { action } = req.body;
  if (!['in', 'out'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const today = startOfDay(new Date());
  let record = await Attendance.findOne({ user: req.user.id, date: today });
  if (!record) {
    record = await Attendance.create({ user: req.user.id, date: today, firstPunchIn: new Date() });
    return res.json({ attendance: record });
  }

  if (action === 'in') {
    if (!record.firstPunchIn) record.firstPunchIn = new Date();
  } else {
    record.lastPunchOut = new Date();
  }
  await record.save();
  res.json({ attendance: record });
});

router.get('/today', auth, async (req, res) => {
  const today = startOfDay(new Date());
  const record = await Attendance.findOne({ user: req.user.id, date: today });
  res.json({ attendance: record });
});

router.get('/company/today', auth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.user.primaryRole)) return res.status(403).json({ error: 'Forbidden' });
  const today = startOfDay(new Date());
  const users = await User.find({ company: req.user.company }).select('_id name');
  const records = await Attendance.find({ user: { $in: users.map(u => u._id) }, date: today }).populate('user', 'name');
  res.json({
    attendance: records.map(r => ({
      user: { id: r.user._id, name: r.user.name },
      firstPunchIn: r.firstPunchIn,
      lastPunchOut: r.lastPunchOut
    }))
  });
});

module.exports = router;
