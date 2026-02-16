const mongoose = require("mongoose");

const UnpaidLeaveAdjustmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    month: {
      type: String,
      required: true,
    },
    deducted: {
      type: Number,
      default: 0,
    },
    note: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

UnpaidLeaveAdjustmentSchema.index(
  { company: 1, employee: 1, month: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "UnpaidLeaveAdjustment",
  UnpaidLeaveAdjustmentSchema
);
