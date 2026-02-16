const mongoose = require("mongoose");

const KraMetricSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    target: { type: String },
    weight: { type: Number, default: 0 },
  },
  { _id: false }
);

const KraSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    questionKey: { type: String },
    roleKey: { type: String },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    metrics: { type: [KraMetricSchema], default: [] },
    status: { type: String, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },
    selfReviewEnabled: { type: Boolean, default: true },
    selfReviewOpenFrom: { type: Date },
    selfReviewOpenTo: { type: Date },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    // Reviews captured through self / manager / admin flows
    selfReview: {
      answer: { type: String },
      rating: { type: Number },
      submittedAt: { type: Date },
    },
    managerReview: {
      manager: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
      rating: { type: Number },
      comments: { type: String },
      submittedAt: { type: Date },
    },
    adminReview: {
      admin: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
      rating: { type: Number },
      comments: { type: String },
      submittedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Kra", KraSchema);
