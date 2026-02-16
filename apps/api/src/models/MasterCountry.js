const mongoose = require("mongoose");

const MasterCountrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    isoCode: { type: String, trim: true, uppercase: true },
    phoneCode: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

MasterCountrySchema.index({ nameKey: 1 }, { unique: true });

module.exports = mongoose.model("MasterCountry", MasterCountrySchema);
