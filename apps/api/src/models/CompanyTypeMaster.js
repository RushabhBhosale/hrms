const mongoose = require("mongoose");

const CompanyTypeMasterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

CompanyTypeMasterSchema.index({ nameKey: 1 }, { unique: true });

module.exports = mongoose.model("CompanyTypeMaster", CompanyTypeMasterSchema);
