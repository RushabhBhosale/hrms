const mongoose = require("mongoose");

const AttendancePenaltySchema = new mongoose.Schema(
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
    date: { type: Date, required: true },
    units: { type: Number, default: 1 },
    allocations: {
      paid: { type: Number, default: 0 },
      casual: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
    },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

AttendancePenaltySchema.index(
  { employee: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { resolvedAt: { $eq: null } },
  }
);

module.exports = mongoose.model("AttendancePenalty", AttendancePenaltySchema);
