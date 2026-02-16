const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    website: { type: String },
    logo: { type: String }, // uploaded logo file key
    logoUrl: { type: String },
    pointOfContact: { type: String },
    pointEmail: { type: String },
    pointPhone: { type: String },
    bio: { type: String },
    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Client', ClientSchema);
