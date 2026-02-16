const mongoose = require("mongoose");

const MasterStateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    stateKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    countryKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    countryName: { type: String, required: true, trim: true },
    country: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MasterCountry",
      required: true,
    },
    isoCode: { type: String, trim: true, uppercase: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

MasterStateSchema.index({ countryKey: 1, nameKey: 1 }, { unique: true });
MasterStateSchema.index({ stateKey: 1 }, { unique: true });

module.exports = mongoose.model("MasterState", MasterStateSchema);
