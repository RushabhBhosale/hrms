const mongoose = require('mongoose');
const { fieldEncryption } = require('mongoose-field-encryption');

const SalarySlipSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    month: { type: String, required: true }, // format: YYYY-MM
    values: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SalarySlipSchema.index({ employee: 1, company: 1, month: 1 }, { unique: true });

// Encrypt entire slip values map (contains earnings/deductions and misc info)
const secret = process.env.ENC_KEY || '12345678901234567890123456789012';
SalarySlipSchema.plugin(fieldEncryption, {
  fields: ['values'],
  secret,
});

module.exports = mongoose.model('SalarySlip', SalarySlipSchema);
