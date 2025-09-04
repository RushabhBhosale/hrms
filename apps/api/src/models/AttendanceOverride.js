const mongoose = require('mongoose');
const encrypt = require('mongoose-encryption');

// Per-employee, per-day overrides for reporting calculations
// Used to ignore half-days, late marks, or holidays for specific dates
const AttendanceOverrideSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true }, // start of day (server local)
    ignoreHalfDay: { type: Boolean, default: false },
    ignoreLate: { type: Boolean, default: false },
    ignoreHoliday: { type: Boolean, default: false },
    reason: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

AttendanceOverrideSchema.index({ employee: 1, date: 1 }, { unique: true });

// ---- Encryption plugin ----
const encKey = process.env.ENC_KEY; // 32-byte key (base64)
if (!encKey) {
  console.warn('⚠️ ENC_KEY not set — AttendanceOverride.reason will NOT be encrypted!');
}

AttendanceOverrideSchema.plugin(encrypt, {
  secret: encKey,
  encryptedFields: ['reason'],
  requireAuthenticationCode: false,
});

module.exports = mongoose.model('AttendanceOverride', AttendanceOverrideSchema);
