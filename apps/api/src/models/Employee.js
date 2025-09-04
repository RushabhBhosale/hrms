const mongoose = require("mongoose");
const encrypt = require("mongoose-encryption");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true }, // hash itself is safe, no need to encrypt
    primaryRole: {
      type: String,
      enum: ["SUPERADMIN", "ADMIN", "EMPLOYEE"],
      default: "EMPLOYEE",
    },
    subRoles: { type: [String], default: [] },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    address: { type: String },
    phone: { type: String },
    dob: { type: Date },
    employeeId: { type: String, unique: true, index: true },
    aadharNumber: { type: String },
    panNumber: { type: String },
    bankDetails: {
      accountNumber: { type: String },
      bankName: { type: String },
      ifsc: { type: String },
    },
    ctc: { type: Number, default: 0 },
    documents: { type: [String], default: [] },
    reportingPerson: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    leaveBalances: {
      casual: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
    },
    totalLeaveAvailable: { type: Number, default: 0 },
    leaveUsage: {
      paid: { type: Number, default: 0 },
      casual: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
    },
    leaveAccrual: {
      lastAccruedYearMonth: { type: String }, // YYYY-MM
    },
    resetOtpHash: { type: String },
    resetOtpExpires: { type: Date },
    resetOtpAttempts: { type: Number, default: 0 },
    resetOtpLastSentAt: { type: Date },
  },
  { timestamps: true }
);

// ---- Encryption plugin ----
const encKey = process.env.ENC_KEY; // 32-byte key (base64) from env
if (!encKey) {
  console.warn("⚠️ ENC_KEY not set — data will NOT be encrypted!");
}

// Encrypt sensitive fields
EmployeeSchema.plugin(encrypt, {
  secret: encKey,
  encryptedFields: [
    "address",
    "dob",
    "aadharNumber",
    "panNumber",
    "bankDetails.accountNumber",
    "bankDetails.ifsc",
    "bankDetails.bankName",
    "documents",
  ],
  requireAuthenticationCode: false,
});

module.exports = mongoose.model("Employee", EmployeeSchema);
