const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const { auth } = require("../middleware/auth");
const { syncLeaveBalances } = require("../utils/leaveBalances");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const {
  ensureCompanyRoleDefaults,
  computeEmployeePermissions,
} = require("../utils/permissions");
const {
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizePhone,
  normalizeAadhaar,
  isValidAadhaar,
  normalizePan,
  isValidPan,
} = require("../utils/validate");
const ms = (n) => n; // clarity helper

function generateOtp() {
  // 6-digit numeric OTP, zero-padded
  const n = Math.floor(Math.random() * 1000000);
  return String(n).padStart(6, "0");
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !isValidPassword(password)) {
    return res.status(400).json({ error: "Invalid email or password" });
  }
  const employee = await Employee.findOne({ email });
  if (!employee) return res.status(400).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  if (employee.primaryRole !== "SUPERADMIN" && employee.company) {
    const company = await Company.findById(employee.company).select(
      "status name"
    );
    if (!company || company.status !== "approved") {
      return res.status(403).json({
        error: "Your company is not approved. Please contact support.",
      });
    }
  }

  await syncLeaveBalances(employee);

  let companyDoc = null;
  if (employee.primaryRole === "ADMIN") {
    companyDoc = await Company.findOne({ admin: employee._id });
    if (!companyDoc && employee.company) {
      companyDoc = await Company.findById(employee.company);
    }
  } else if (employee.company) {
    companyDoc = await Company.findById(employee.company);
  }

  if (companyDoc) {
    const ensured = ensureCompanyRoleDefaults(companyDoc);
    if (ensured) await companyDoc.save();
  }

  const permissions = computeEmployeePermissions(companyDoc, employee);

  // Ensure encrypted fields are decrypted for response payload
  try {
    employee.decryptFieldsSync();
  } catch (_) {}
  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    personalEmail: employee.personalEmail,
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
    permissions,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, employee: payload });
});

// Change password for logged-in users
router.post("/change-password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!isValidPassword(newPassword)) {
    return res
      .status(400)
      .json({ error: "Password must be more than 5 characters" });
  }

  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: "Not found" });

  const ok = await bcrypt.compare(currentPassword, employee.passwordHash);
  if (!ok)
    return res.status(400).json({ error: "Current password is incorrect" });

  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(newPassword, salt);
  // Clear any outstanding reset OTPs
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();

  res.json({ message: "Password changed successfully" });
});

// Request password reset OTP (email-based)
router.post("/request-password-reset", async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    // Do not leak which emails exist; pretend success
    return res.json({ message: "If the email exists, an OTP was sent" });
  }

  const employee = await Employee.findOne({ email: String(email).trim() });
  if (!employee) {
    return res.json({ message: "If the email exists, an OTP was sent" });
  }

  // Throttle re-sends to 1 per 60s
  const now = new Date();
  if (
    employee.resetOtpLastSentAt &&
    now - employee.resetOtpLastSentAt < 60 * 1000
  ) {
    return res.json({ message: "If the email exists, an OTP was sent" });
  }

  const otp = generateOtp();
  const salt = await bcrypt.genSalt(10);
  employee.resetOtpHash = await bcrypt.hash(otp, salt);
  employee.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  employee.resetOtpAttempts = 0;
  employee.resetOtpLastSentAt = now;
  await employee.save();

  const subject = "Your HRMS Password Reset OTP";
  const text = `Use this code to reset your password: ${otp}\n\nThis code will expire in 10 minutes.`;
  const html = `<p>Use this code to reset your password:</p><p style="font-size:20px;font-weight:bold">${otp}</p><p>This code will expire in 10 minutes.</p>`;

  try {
    await sendMail({ to: employee.email, subject, text, html });
  } catch (e) {
    // Intentionally swallow errors to avoid email enumeration
    console.warn("[auth] Failed to send reset OTP email:", e?.message || e);
  }

  if (!isEmailEnabled() && process.env.NODE_ENV !== "production") {
    console.log(`[dev] Password reset OTP for ${employee.email}: ${otp}`);
  }

  res.json({ message: "If the email exists, an OTP was sent" });
});

// Verify OTP and issue short-lived reset token
router.post("/verify-reset-otp", async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp)
    return res.status(400).json({ error: "Missing required fields" });
  const employee = await Employee.findOne({ email: String(email).trim() });
  const cleanedOtp = String(otp).replace(/\D/g, "");
  if (cleanedOtp.length !== 6)
    return res.status(400).json({ error: "Invalid or expired OTP" });
  if (!employee || !employee.resetOtpHash || !employee.resetOtpExpires) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  if (employee.resetOtpExpires.getTime() < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  if (employee.resetOtpAttempts >= 5) {
    return res
      .status(400)
      .json({ error: "Too many attempts. Request a new OTP." });
  }
  const ok = await bcrypt.compare(cleanedOtp, employee.resetOtpHash);
  if (!ok) {
    employee.resetOtpAttempts = (employee.resetOtpAttempts || 0) + 1;
    await employee.save();
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  // Successful verification: issue a short-lived token for password reset completion
  const resetToken = jwt.sign(
    { sub: employee._id.toString(), purpose: "password_reset" },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  // Do not clear OTP yet, so user can retry if they lose token; it will expire anyway
  res.json({ resetToken });
});

// Complete password reset using resetToken
router.post("/complete-password-reset", async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword)
    return res.status(400).json({ error: "Missing required fields" });
  if (!isValidPassword(newPassword))
    return res
      .status(400)
      .json({ error: "Password must be more than 5 characters" });
  let decoded;
  try {
    decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: "Invalid or expired token" });
  }
  if (decoded.purpose !== "password_reset" || !decoded.sub) {
    return res.status(400).json({ error: "Invalid token" });
  }
  const employee = await Employee.findById(decoded.sub);
  if (!employee) return res.status(404).json({ error: "Not found" });
  // Ensure an active OTP session still exists (defense-in-depth)
  if (
    !employee.resetOtpExpires ||
    employee.resetOtpExpires.getTime() < Date.now()
  ) {
    return res
      .status(400)
      .json({ error: "OTP session expired. Request a new code." });
  }
  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(String(newPassword), salt);
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();
  res.json({ message: "Password has been reset" });
});
// Reset password using email + OTP
router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!isValidPassword(newPassword)) {
    return res
      .status(400)
      .json({ error: "Password must be more than 5 characters" });
  }

  const employee = await Employee.findOne({ email: String(email).trim() });
  if (!employee || !employee.resetOtpHash || !employee.resetOtpExpires) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  if (employee.resetOtpExpires.getTime() < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  if (employee.resetOtpAttempts >= 5) {
    return res
      .status(400)
      .json({ error: "Too many attempts. Request a new OTP." });
  }

  const cleanedOtp = String(otp).replace(/\D/g, "");
  if (cleanedOtp.length !== 6)
    return res.status(400).json({ error: "Invalid or expired OTP" });
  const ok = await bcrypt.compare(cleanedOtp, employee.resetOtpHash);
  if (!ok) {
    employee.resetOtpAttempts = (employee.resetOtpAttempts || 0) + 1;
    await employee.save();
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }

  const salt = await bcrypt.genSalt(10);
  employee.passwordHash = await bcrypt.hash(String(newPassword), salt);
  // Clear reset state
  employee.resetOtpHash = undefined;
  employee.resetOtpExpires = undefined;
  employee.resetOtpAttempts = 0;
  await employee.save();

  res.json({ message: "Password has been reset" });
});

router.get("/me", auth, async (req, res) => {
  const PLUS =
    "+phone +address +personalEmail +aadharNumber +panNumber +bankDetails.accountNumber +bankDetails.ifsc +dob +ctc +joiningDate";

  let employee = await Employee.findById(req.employee.id).select(PLUS);
  if (!employee) return res.status(404).json({ error: "Not found" });

  await syncLeaveBalances(employee);

  employee = await Employee.findById(req.employee.id).select(PLUS);
  try {
    if (typeof employee.decryptFieldsSync === "function") {
      employee.decryptFieldsSync();
    } else if (typeof employee.decrypt === "function") {
      employee.decrypt();
    }
  } catch (e) {
    console.error("Decryption failed:", e);
    return res.status(500).json({ error: "Decryption failed" });
  }

  let companyDoc = null;
  if (employee.primaryRole === "ADMIN") {
    companyDoc = await Company.findOne({ admin: employee._id });
    if (!companyDoc && employee.company) {
      companyDoc = await Company.findById(employee.company);
    }
  } else if (employee.company) {
    companyDoc = await Company.findById(employee.company);
  }

  if (companyDoc) {
    const ensured = ensureCompanyRoleDefaults(companyDoc);
    if (ensured) await companyDoc.save();
  }

  const permissions = computeEmployeePermissions(companyDoc, employee);

  const payload = {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    personalEmail: employee.personalEmail,
    phone: employee.phone,
    address: employee.address,
    dob: employee.dob,
    joiningDate: employee.joiningDate,
    createdAt: employee.createdAt,
    primaryRole: employee.primaryRole,
    subRoles: employee.subRoles,
    company: employee.company,
    leaveBalances: employee.leaveBalances,
    totalLeaveAvailable: employee.totalLeaveAvailable || 0,
    employeeId: employee.employeeId,
    aadharNumber: employee.aadharNumber,
    panNumber: employee.panNumber,
    bankDetails: employee.bankDetails,
    permissions,
  };

  res.json({ employee: payload });
});

router.put("/me", auth, async (req, res) => {
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
    personalEmail,
  } = req.body;
  const employee = await Employee.findById(req.employee.id);
  if (!employee) return res.status(404).json({ error: "Not found" });

  const isPrivileged = ["ADMIN", "SUPERADMIN"].includes(employee.primaryRole);

  // Basic allowlist: update common profile fields, never employeeId/roles/company via this route
  if (name !== undefined) employee.name = String(name);

  if (email !== undefined && email !== employee.email) {
    if (!isPrivileged)
      return res.status(400).json({
        error: "Company email can only be updated by an administrator",
      });
    const nextEmail = String(email).trim();
    if (!isValidEmail(nextEmail)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    const exists = await Employee.findOne({
      email: nextEmail,
      _id: { $ne: employee._id },
    });
    if (exists) return res.status(400).json({ error: "Email already in use" });
    employee.email = nextEmail;
  }

  if (phone !== undefined) {
    if (phone === null || phone === "") {
      employee.phone = undefined;
    } else {
      if (!isValidPhone(phone))
        return res
          .status(400)
          .json({ error: "Phone must be exactly 10 digits" });
      employee.phone = normalizePhone(phone);
    }
  }
  if (address !== undefined) employee.address = String(address);
  if (dob !== undefined) {
    const d = new Date(dob);
    if (isNaN(d.getTime()))
      return res.status(400).json({ error: "Invalid date of birth" });
    employee.dob = d;
  }
  if (aadharNumber !== undefined) {
    const rawAadhaar = String(aadharNumber).trim();
    const digits = normalizeAadhaar(rawAadhaar);
    const currentDigits = normalizeAadhaar(employee.aadharNumber || "");
    if (!isPrivileged) {
      if (digits !== currentDigits) {
        return res.status(400).json({
          error: "Aadhaar updates are restricted. Contact your administrator.",
        });
      }
    } else {
      if (rawAadhaar && !digits) {
        return res.status(400).json({ error: "Invalid Aadhaar number" });
      }
      if (digits && !isValidAadhaar(digits)) {
        return res.status(400).json({ error: "Invalid Aadhaar number" });
      }
      employee.aadharNumber = digits || undefined;
    }
  }
  if (panNumber !== undefined) {
    const rawPan = String(panNumber).trim();
    const normalizedPan = rawPan ? normalizePan(rawPan) : "";
    const currentPan = employee.panNumber
      ? normalizePan(employee.panNumber)
      : "";
    if (!isPrivileged) {
      if (normalizedPan !== currentPan) {
        return res.status(400).json({
          error: "PAN updates are restricted. Contact your administrator.",
        });
      }
    } else {
      if (normalizedPan) {
        if (!isValidPan(normalizedPan)) {
          return res.status(400).json({ error: "Invalid PAN number" });
        }
        employee.panNumber = normalizedPan;
      } else {
        employee.panNumber = undefined;
      }
    }
  }
  if (personalEmail !== undefined) {
    const trimmed = String(personalEmail).trim();
    if (!trimmed) {
      employee.personalEmail = undefined;
    } else {
      if (!isValidEmail(trimmed)) {
        return res.status(400).json({ error: "Invalid personal email" });
      }
      employee.personalEmail = trimmed;
    }
  }
  employee.bankDetails = {
    accountNumber: bankAccountNumber || employee.bankDetails?.accountNumber,
    bankName: bankName || employee.bankDetails?.bankName,
    ifsc: bankIfsc || employee.bankDetails?.ifsc,
  };
  await employee.save();
  res.json({ message: "Profile updated" });
});

module.exports = router;
