const router = require('express').Router();
const { auth } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const Company = require('../models/Company');

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

router.get('/history/:employeeId?', auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: 'Forbidden' });
  const records = await Attendance.find({ employee: targetId }).sort({ date: -1 });
  res.json({ attendance: records });
});

// Monthly work report for an employee
router.get('/report/:employeeId?', auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: 'Forbidden' });

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

  const workedDays = await Attendance.countDocuments({
    employee: targetId,
    date: { $gte: start, $lt: end }
  });

  const emp = await Employee.findById(targetId).select('company');
  const company = emp ? await Company.findById(emp.company).select('bankHolidays') : null;

  const bankHolidays = (company?.bankHolidays || [])
    .filter((h) => h.date >= start && h.date < end)
    .map((h) => startOfDay(h.date).toISOString().slice(0, 10));

  const leaves = await Leave.find({
    employee: targetId,
    status: 'APPROVED',
    startDate: { $lte: end },
    endDate: { $gte: start }
  });
  const holidaySet = new Set(
    (company?.bankHolidays || []).map((h) => startOfDay(h.date).getTime())
  );
  const leaveDates = [];
  for (const l of leaves) {
    let s = l.startDate < start ? startOfDay(start) : startOfDay(l.startDate);
    let e = l.endDate > end ? startOfDay(new Date(end.getTime() - 1)) : startOfDay(l.endDate);
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

router.get('/company/today', auth, async (req, res) => {
  const allowed =
    ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
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
  const allowed =
    ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
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

router.get('/company/report', auth, async (req, res) => {
  const allowed =
    ['ADMIN', 'SUPERADMIN'].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ['hr', 'manager'].includes(r));
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

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

  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: 'EMPLOYEE'
  }).select('_id name');

  const counts = await Attendance.aggregate([
    {
      $match: {
        employee: { $in: employees.map((u) => u._id) },
        date: { $gte: start, $lt: end }
      }
    },
    { $group: { _id: '$employee', workedDays: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.workedDays]));

  const company = await Company.findById(req.employee.company).select('bankHolidays');

  const report = [];
  for (const emp of employees) {
    const leaves = await Leave.find({
      employee: emp._id,
      status: 'APPROVED',
      startDate: { $lte: end },
      endDate: { $gte: start }
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
      leaveDays
    });
  }

  res.json({ report });
});

module.exports = router;
