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
    phone: employee.phone,
    address: employee.address,
    dob: employee.dob,
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
    phone: employee.phone,
    address: employee.address,
    dob: employee.dob,
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
  const {
    name,
    email,
    phone,
    address,
    dob,
    aadharNumber,
    panNumber,
    bankName,
    bankAccountNumber,
    bankIfsc,
  } = req.body;
  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: 'Not found' });

  // Basic allowlist: update common profile fields, never employeeId/roles/company via this route
  if (name !== undefined) employee.name = String(name);

  if (email !== undefined && email !== employee.email) {
    const nextEmail = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    // Enforce uniqueness
    const exists = await Employee.findOne({ email: nextEmail, _id: { $ne: employee._id } });
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    employee.email = nextEmail;
  }

  if (phone !== undefined) employee.phone = String(phone);
  if (address !== undefined) employee.address = String(address);
  if (dob !== undefined) {
    const d = new Date(dob);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
    employee.dob = d;
  }
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
