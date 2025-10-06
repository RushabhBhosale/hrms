const mongoose = require("mongoose");
const { fieldEncryption } = require("mongoose-field-encryption");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    primaryRole: {
      type: String,
      enum: ["SUPERADMIN", "ADMIN", "EMPLOYEE"],
      default: "EMPLOYEE",
    },
    subRoles: { type: [String], default: [] },
    employmentStatus: {
      type: String,
      enum: ["PERMANENT", "PROBATION"],
      default: "PROBATION",
    },
    probationSince: { type: Date },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    address: { type: String },
    phone: { type: String },
    personalEmail: { type: String },
    bloodGroup: {
      type: String,
      enum: [
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
      ],
    },
    dob: { type: Date },
    joiningDate: { type: Date },
    employeeId: { type: String },
    aadharNumber: { type: String },
    panNumber: { type: String },
    bankDetails: {
      accountNumber: { type: String },
      bankName: { type: String },
      ifsc: { type: String },
    },
    // Monthly CTC used for salary computations
    ctc: { type: Number, default: 0 },
    documents: { type: [String], default: [] },
    reportingPerson: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    // Derived/display leave balances (kept for backward-compatible API payloads)
    leaveBalances: {
      casual: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
    },
    // New simplified leave tracking
    totalLeaveAvailable: { type: Number, default: 0 }, // total untyped leaves available
    leaveUsage: {
      paid: { type: Number, default: 0 },
      casual: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
    },
    // Leave accrual tracking
    leaveAccrual: {
      lastAccruedYearMonth: { type: String }, // format: YYYY-MM (month we last accrued up to)
      manualAdjustment: { type: Number, default: 0 }, // manual overrides applied by admin
    },
    // Password reset (OTP) fields
    resetOtpHash: { type: String },
    resetOtpExpires: { type: Date },
    resetOtpAttempts: { type: Number, default: 0 },
    resetOtpLastSentAt: { type: Date },
  },
  { timestamps: true }
);

// Encrypt sensitive PII and compensation fields
// Do NOT encrypt fields used for login/lookup/indexes (email, employeeId, name, company, roles)
const secret = process.env.ENC_KEY || "12345678901234567890123456789012";
EmployeeSchema.plugin(fieldEncryption, {
  fields: [
    "address",
    "phone",
    "personalEmail",
    "bloodGroup",
    "dob",
    "joiningDate",
    "aadharNumber",
    "panNumber",
    "bankDetails",
    "ctc",
  ],
  secret,
});

module.exports = mongoose.model("Employee", EmployeeSchema);
