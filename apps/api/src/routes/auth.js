const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');
const { auth } = require('../middleware/auth');
const { syncLeaveBalances } = require('../utils/leaveBalances');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const employee = await Employee.findOne({ email });
  if (!employee) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  await syncLeaveBalances(employee);
  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    primaryRole: employee.primaryRole,
    subRoles: employee.subRoles,
    company: employee.company,
    leaveBalances: employee.leaveBalances,
    employeeId: employee.employeeId,
    aadharNumber: employee.aadharNumber,
    panNumber: employee.panNumber,
    bankDetails: employee.bankDetails,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, employee: payload });
});

router.get('/me', auth, async (req, res) => {
  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: 'Not found' });
  await syncLeaveBalances(employee);
  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    primaryRole: employee.primaryRole,
    subRoles: employee.subRoles,
    company: employee.company,
    leaveBalances: employee.leaveBalances,
    employeeId: employee.employeeId,
    aadharNumber: employee.aadharNumber,
    panNumber: employee.panNumber,
    bankDetails: employee.bankDetails,
  };
  res.json({ employee: payload });
});

router.put('/me', auth, async (req, res) => {
  const { aadharNumber, panNumber, bankName, bankAccountNumber, bankIfsc } = req.body;
  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: 'Not found' });
  if (aadharNumber !== undefined) employee.aadharNumber = aadharNumber;
  if (panNumber !== undefined) employee.panNumber = panNumber;
  employee.bankDetails = {
    accountNumber: bankAccountNumber || employee.bankDetails?.accountNumber,
    bankName: bankName || employee.bankDetails?.bankName,
    ifsc: bankIfsc || employee.bankDetails?.ifsc,
  };
  await employee.save();
  res.json({ message: 'Profile updated' });
});

module.exports = router;
