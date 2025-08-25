const router = require('express').Router();
const { auth } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.post('/punch', auth, async (req, res) => {
  const { action } = req.body;
  if (!['in', 'out'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const today = startOfDay(new Date());
  let record = await Attendance.findOne({ employee: req.employee.id, date: today });
  const now = new Date();
  if (!record) {
    if (action === 'out') return res.status(400).json({ error: 'Must punch in first' });
    record = await Attendance.create({
      employee: req.employee.id,
      date: today,
      firstPunchIn: now,
      lastPunchIn: now
    });
    return res.json({ attendance: record });
  }

  if (action === 'in') {
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
    }
  }
  await record.save();
  res.json({ attendance: record });
});

router.get('/today', auth, async (req, res) => {
  const today = startOfDay(new Date());
  const record = await Attendance.findOne({ employee: req.employee.id, date: today });
  res.json({ attendance: record });
});

router.get('/history', auth, async (req, res) => {
  const records = await Attendance.find({ employee: req.employee.id }).sort({ date: -1 });
  res.json({ attendance: records });
});

router.get('/company/today', auth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole)) return res.status(403).json({ error: 'Forbidden' });
  const today = startOfDay(new Date());
  const employees = await Employee.find({ company: req.employee.company, primaryRole: 'EMPLOYEE' }).select('_id name');
  const records = await Attendance.find({ employee: { $in: employees.map(u => u._id) }, date: today });

  const attendance = employees.map(u => {
    const record = records.find(r => r.employee.toString() === u._id.toString());
    return {
      employee: { id: u._id, name: u.name },
      firstPunchIn: record?.firstPunchIn,
      lastPunchOut: record?.lastPunchOut
    };
  });

  res.json({ attendance });
});

router.get('/company/history', auth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole)) return res.status(403).json({ error: 'Forbidden' });
  const { month } = req.query;
  let start;
  if (month) {
    start = startOfDay(new Date(month + '-01'));
  } else {
    const now = new Date();
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const employees = await Employee.find({ company: req.employee.company, primaryRole: 'EMPLOYEE' }).select('_id name');
  const records = await Attendance.find({
    employee: { $in: employees.map(u => u._id) },
    date: { $gte: start, $lt: end }
  });

  const attendance = records.map(r => {
    const emp = employees.find(u => u._id.toString() === r.employee.toString());
    return {
      employee: { id: emp?._id, name: emp?.name },
      date: r.date,
      firstPunchIn: r.firstPunchIn,
      lastPunchOut: r.lastPunchOut,
      workedMs: r.workedMs
    };
  });

  res.json({ attendance });
});

module.exports = router;
