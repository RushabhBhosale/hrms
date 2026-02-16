const mongoose = require('mongoose');

const RecurringSchema = new mongoose.Schema(
  {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    },
    startDate: { type: Date },
    nextDueDate: { type: Date },
    reminderDaysBefore: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const VoucherSchema = new mongoose.Schema(
  {
    number: { type: String },
    authorizedBy: { type: String },
    sequenceKey: { type: String },
    pdfFile: { type: String },
    generatedAt: { type: Date },
  },
  { _id: false }
);

const ExpenseSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExpenseCategory',
      required: true,
    },
    categoryName: { type: String, required: true },
    description: { type: String },
    notes: { type: String },
    amount: { type: Number, required: true, min: 0 },
    paidBy: {
      type: String,
      enum: ['cash', 'bank', 'upi', 'card'],
      required: true,
    },
    attachments: { type: [String], default: [] },
    isRecurring: { type: Boolean, default: false },
    recurring: { type: RecurringSchema, default: null },
    hasVoucher: { type: Boolean, default: false },
    voucher: { type: VoucherSchema, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ExpenseSchema.index({ company: 1, date: -1 });
ExpenseSchema.index({ company: 1, 'recurring.nextDueDate': 1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
