const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');
const { auth } = require('../middleware/auth');
const { syncLeaveBalances } = require('../utils/leaveBalances');
const { sendMail, isEmailEnabled } = require('../utils/mailer');
const ms = (n) => n; // clarity helper

function generateOtp() {
  // 6-digit numeric OTP, zero-padded
  const n = Math.floor(Math.random() * 1000000);
  return String(n).padStart(6, '0');
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const employee = await Employee.findOne({ email });
  if (!employee) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  await syncLeaveBalances(employee);
  // Ensure encrypted fields are decrypted for response payload
  try { employee.decryptFieldsSync(); } catch (_) {}
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
    totalLeaveAvailable: employee.totalLeaveAvailable || 0,
    employeeId: employee.employeeId,
    aadharNumber: employee.aadharNumber,
    panNumber: employee.panNumber,
    bankDetails: employee.bankDetails,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, employee: payload });
});

// Change password for logged-in users
router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: 'Not found' });

  const ok = await bcrypt.compare(currentPassword, employee.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(newPassword, salt);
  // Clear any outstanding reset OTPs
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();

  res.json({ message: 'Password changed successfully' });
});

// Request password reset OTP (email-based)
router.post('/request-password-reset', async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    // Do not leak which emails exist; pretend success
    return res.json({ message: 'If the email exists, an OTP was sent' });
  }

  const employee = await Employee.findOne({ email: String(email).trim() });
  if (!employee) {
    return res.json({ message: 'If the email exists, an OTP was sent' });
  }

  // Throttle re-sends to 1 per 60s
  const now = new Date();
  if (employee.resetOtpLastSentAt && now - employee.resetOtpLastSentAt < 60 * 1000) {
    return res.json({ message: 'If the email exists, an OTP was sent' });
  }

  const otp = generateOtp();
  const salt = await bcrypt.genSalt(10);
  employee.resetOtpHash = await bcrypt.hash(otp, salt);
  employee.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  employee.resetOtpAttempts = 0;
  employee.resetOtpLastSentAt = now;
  await employee.save();

  const subject = 'Your HRMS Password Reset OTP';
  const text = `Use this code to reset your password: ${otp}\n\nThis code will expire in 10 minutes.`;
  const html = `<p>Use this code to reset your password:</p><p style="font-size:20px;font-weight:bold">${otp}</p><p>This code will expire in 10 minutes.</p>`;

  try {
    await sendMail({ to: employee.email, subject, text, html });
  } catch (e) {
    // Intentionally swallow errors to avoid email enumeration
    console.warn('[auth] Failed to send reset OTP email:', e?.message || e);
  }

  if (!isEmailEnabled() && process.env.NODE_ENV !== 'production') {
    console.log(`[dev] Password reset OTP for ${employee.email}: ${otp}`);
  }

  res.json({ message: 'If the email exists, an OTP was sent' });
});

// Verify OTP and issue short-lived reset token
router.post('/verify-reset-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ error: 'Missing required fields' });
  const employee = await Employee.findOne({ email: String(email).trim() });
  const cleanedOtp = String(otp).replace(/\D/g, '');
  if (cleanedOtp.length !== 6) return res.status(400).json({ error: 'Invalid or expired OTP' });
  if (!employee || !employee.resetOtpHash || !employee.resetOtpExpires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  if (employee.resetOtpExpires.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  if (employee.resetOtpAttempts >= 5) {
    return res.status(400).json({ error: 'Too many attempts. Request a new OTP.' });
  }
  const ok = await bcrypt.compare(cleanedOtp, employee.resetOtpHash);
  if (!ok) {
    employee.resetOtpAttempts = (employee.resetOtpAttempts || 0) + 1;
    await employee.save();
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  // Successful verification: issue a short-lived token for password reset completion
  const resetToken = jwt.sign({ sub: employee._id.toString(), purpose: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  // Do not clear OTP yet, so user can retry if they lose token; it will expire anyway
  res.json({ resetToken });
});

// Complete password reset using resetToken
router.post('/complete-password-reset', async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'Missing required fields' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  let decoded;
  try {
    decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  if (decoded.purpose !== 'password_reset' || !decoded.sub) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  const employee = await Employee.findById(decoded.sub);
  if (!employee) return res.status(404).json({ error: 'Not found' });
  // Ensure an active OTP session still exists (defense-in-depth)
  if (!employee.resetOtpExpires || employee.resetOtpExpires.getTime() < Date.now()) {
    return res.status(400).json({ error: 'OTP session expired. Request a new code.' });
  }
  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(String(newPassword), salt);
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();
  res.json({ message: 'Password has been reset' });
});
// Reset password using email + OTP
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const employee = await Employee.findOne({ email: String(email).trim() });
  if (!employee || !employee.resetOtpHash || !employee.resetOtpExpires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  if (employee.resetOtpExpires.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  if (employee.resetOtpAttempts >= 5) {
    return res.status(400).json({ error: 'Too many attempts. Request a new OTP.' });
  }

  const cleanedOtp = String(otp).replace(/\D/g, '');
  if (cleanedOtp.length !== 6) return res.status(400).json({ error: 'Invalid or expired OTP' });
  const ok = await bcrypt.compare(cleanedOtp, employee.resetOtpHash);
  if (!ok) {
    employee.resetOtpAttempts = (employee.resetOtpAttempts || 0) + 1;
    await employee.save();
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(String(newPassword), salt);
  // Clear reset state
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();

  res.json({ message: 'Password has been reset' });
});

router.get('/me', auth, async (req, res) => {
  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: 'Not found' });
  try { employee.decryptFieldsSync(); } catch (_) {}
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
    totalLeaveAvailable: employee.totalLeaveAvailable || 0,
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
