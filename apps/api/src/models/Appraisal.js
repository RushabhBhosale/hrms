const mongoose = require("mongoose");

const KraResultSchema = new mongoose.Schema(
  {
    kra: { type: mongoose.Schema.Types.ObjectId, ref: "Kra" },
    rating: { type: Number },
    comments: { type: String },
  },
  { _id: false }
);

const AppraisalSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    overallRating: { type: Number },
    summary: { type: String },
    kraResults: { type: [KraResultSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appraisal", AppraisalSchema);
