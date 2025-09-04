const mongoose = require('mongoose');

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

module.exports = mongoose.model('SalarySlip', SalarySlipSchema);

