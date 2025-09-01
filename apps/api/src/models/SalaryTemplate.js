const mongoose = require('mongoose');

const SalaryFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'number', 'date'], default: 'text' },
    required: { type: Boolean, default: false },
    // If true, this field is system-defined and cannot be edited/removed in UI
    locked: { type: Boolean, default: false },
    // Category used to group fields in salary slip
    // - earning: counted towards gross earnings
    // - deduction: counted towards total deductions
    // - info: ancillary info displayed separately
    category: { type: String, enum: ['earning', 'deduction', 'info'], default: 'info' },
    defaultValue: { type: mongoose.Schema.Types.Mixed },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const SalaryTemplateSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
    fields: { type: [SalaryFieldSchema], default: [] },
    // Default computation settings for locked fields
    settings: {
      basicPercent: { type: Number, default: 30 }, // Basic Earned = basicPercent% of CTC
      hraPercent: { type: Number, default: 45 },   // HRA = hraPercent% of Basic
      medicalAmount: { type: Number, default: 1500 }, // Flat monthly medical allowance
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SalaryTemplate', SalaryTemplateSchema);
