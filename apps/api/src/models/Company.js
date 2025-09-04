const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    // Optional company logo (stored as filename under /uploads)
    logo: { type: String },
    // Optional separate logos for different layouts
    logoSquare: { type: String },       // compact sidebar / favicon-like
    logoHorizontal: { type: String },   // full-width header/sidebar
    // Registration + approval workflow
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved', // default for legacy/seeded companies
    },
    requestedAdmin: {
      name: { type: String },
      email: { type: String },
      passwordHash: { type: String },
      requestedAt: { type: Date },
    },
    roles: { type: [String], default: ['hr', 'manager', 'developer'] },
    // Leave policy (simplified): total annual leaves, monthly accrual, and per-type caps from the total
    leavePolicy: {
      totalAnnual: { type: Number, default: 0 },
      ratePerMonth: { type: Number, default: 0 },
      typeCaps: {
        paid: { type: Number, default: 0 },
        casual: { type: Number, default: 0 },
        sick: { type: Number, default: 0 },
      },
    },
    // Optional company-wide working hours configuration
    workHours: {
      start: { type: String, default: '' }, // "HH:mm" (server-local time)
      end: { type: String, default: '' },   // "HH:mm"
      graceMinutes: { type: Number, default: 0 }, // minutes allowed before counting late
    },
    bankHolidays: [
      {
        date: { type: Date, required: true },
        name: { type: String }
      }
    ],
    // Optional company-wide color theme (hex codes)
    theme: {
      primary: { type: String },
      secondary: { type: String },
      accent: { type: String },
      success: { type: String },
      warning: { type: String },
      error: { type: String },
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Company', CompanySchema);
