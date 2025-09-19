const mongoose = require('mongoose');

const ExpenseCategorySchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

ExpenseCategorySchema.index({ company: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('ExpenseCategory', ExpenseCategorySchema);
