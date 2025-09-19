const mongoose = require("mongoose");

const MasterCitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    cityKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    stateKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    stateName: { type: String, required: true, trim: true },
    state: { type: mongoose.Schema.Types.ObjectId, ref: "MasterState", required: true },
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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

MasterCitySchema.index({ stateKey: 1, nameKey: 1 }, { unique: true });
MasterCitySchema.index({ cityKey: 1 }, { unique: true });

module.exports = mongoose.model("MasterCity", MasterCitySchema);
