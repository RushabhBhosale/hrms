const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');
const { auth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const employee = await Employee.findOne({ email });
  if (!employee) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    primaryRole: employee.primaryRole,
    subRoles: employee.subRoles,
    company: employee.company,
    leaveBalances: employee.leaveBalances,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, employee: payload });
});

router.get('/me', auth, async (req, res) => {
  const employee = await Employee.findById(req.employee.id).lean();
  if (!employee) return res.status(404).json({ error: 'Not found' });
  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    primaryRole: employee.primaryRole,
    subRoles: employee.subRoles,
    company: employee.company,
    leaveBalances: employee.leaveBalances,
  };
  res.json({ employee: payload });
});

module.exports = router;
