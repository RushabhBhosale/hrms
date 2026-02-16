const mongoose = require("mongoose");

const ONBOARDING_STATUSES = [
  "INTERVIEW",
  "INTERVIEWED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
];

const OnboardingCandidateSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: ONBOARDING_STATUSES,
      default: "INTERVIEW",
    },
    notes: { type: String, default: "" },
    lastEmailSubject: { type: String },
    lastEmailBody: { type: String },
    lastEmailSentAt: { type: Date },
    lastEmailedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OnboardingCandidateSchema.index(
  { company: 1, email: 1, isDeleted: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

module.exports = mongoose.model("OnboardingCandidate", OnboardingCandidateSchema);
module.exports.ONBOARDING_STATUSES = ONBOARDING_STATUSES;
