const mongoose = require("mongoose");

const ReimbursementSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReimbursementType",
      required: true,
      index: true,
    },
    typeName: { type: String, required: true },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    },
    projectName: { type: String },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String },
    employeeNote: { type: String },
    adminNote: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    attachments: { type: [String], default: [] },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ReimbursementSchema.index({ company: 1, status: 1, createdAt: -1 });
ReimbursementSchema.index({ company: 1, employee: 1, createdAt: -1 });
ReimbursementSchema.index({ company: 1, project: 1, createdAt: -1 });

module.exports = mongoose.model("Reimbursement", ReimbursementSchema);
