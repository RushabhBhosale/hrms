const mongoose = require('mongoose');

const SalaryFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'number', 'date'], default: 'text' },
    required: { type: Boolean, default: false },
    defaultValue: { type: mongoose.Schema.Types.Mixed },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const SalaryTemplateSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
    fields: { type: [SalaryFieldSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SalaryTemplate', SalaryTemplateSchema);

