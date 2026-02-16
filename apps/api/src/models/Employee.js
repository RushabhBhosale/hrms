const mongoose = require("mongoose");
const { fieldEncryption } = require("mongoose-field-encryption");
const ENCRYPTED_FIELDS = [
  "address",
  "phone",
  "personalEmail",
  "bloodGroup",
  "dob",
  "aadharNumber",
  "panNumber",
  "bankDetails",
  "uan",
  "ctc",
];

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
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    dob: { type: Date },
    joiningDate: { type: Date },
    attendanceStartDate: { type: Date },
    employeeId: { type: String },
    aadharNumber: { type: String },
    panNumber: { type: String },
    bankDetails: {
      accountNumber: { type: String },
      bankName: { type: String },
      ifsc: { type: String },
    },
    uan: { type: String },
    // Monthly CTC used for salary computations
    ctc: { type: Number, default: 0 },
    documents: { type: [String], default: [] },
    reportingPerson: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    reportingPersons: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Employee",
      default: [],
    },
    hasTds: { type: Boolean, default: false },
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
    // Optional profile image (stored file key or URL)
    profileImage: { type: String },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    offboarding: {
      lastWorkingDay: { type: Date },
      reason: {
        type: String,
        enum: [
          "resignation",
          "termination",
          "layoff",
          "contract_end",
          "absconded",
          "other",
        ],
        default: "other",
      },
      note: { type: String },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
      recordedAt: { type: Date },
    },
    uan: { type: String },
  },
  { timestamps: true }
);

function hasSerializableEncryptionValue(value) {
  if (typeof value === "undefined") return true;
  if (typeof value === "string") return true;
  try {
    return typeof JSON.stringify(value) !== "undefined";
  } catch (_) {
    return false;
  }
}

// Guard against malformed values that can crash encryption middleware.
EmployeeSchema.pre("save", function (next) {
  try {
    for (const field of ENCRYPTED_FIELDS) {
      const value = this.get(field);
      if (!hasSerializableEncryptionValue(value)) {
        this.set(field, undefined);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

EmployeeSchema.pre("insertMany", function (next, docs) {
  try {
    for (const doc of docs || []) {
      for (const field of ENCRYPTED_FIELDS) {
        const value =
          typeof doc?.get === "function" ? doc.get(field) : doc?.[field];
        if (!hasSerializableEncryptionValue(value)) {
          if (typeof doc?.set === "function") doc.set(field, undefined);
          else if (doc && typeof doc === "object") doc[field] = undefined;
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Encrypt sensitive PII and compensation fields
// Do NOT encrypt fields used for login/lookup/indexes (email, employeeId, name, company, roles)
const secret = process.env.ENC_KEY || "12345678901234567890123456789012";
EmployeeSchema.plugin(fieldEncryption, {
  fields: ENCRYPTED_FIELDS,
  secret,
});

module.exports = mongoose.model("Employee", EmployeeSchema);
