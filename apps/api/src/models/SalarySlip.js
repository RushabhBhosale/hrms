const mongoose = require('mongoose');
const encrypt = require('mongoose-encryption');

const SalarySlipSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    month: { type: String, required: true }, // format: YYYY-MM
    values: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

SalarySlipSchema.index({ employee: 1, company: 1, month: 1 }, { unique: true });

// ---- Encryption plugin ----
const encKey = process.env.ENC_KEY; // 32-byte key (base64)
if (!encKey) {
  console.warn('⚠️ ENC_KEY not set — SalarySlip.values will NOT be encrypted!');
}

// Encrypt only the dynamic values map (salary details)
SalarySlipSchema.plugin(encrypt, {
  secret: encKey,
  encryptedFields: ['values'],
  requireAuthenticationCode: false,
});

module.exports = mongoose.model('SalarySlip', SalarySlipSchema);
