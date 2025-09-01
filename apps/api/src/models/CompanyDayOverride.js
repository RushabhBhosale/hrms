const mongoose = require('mongoose');

// Company-wide per-day overrides
// Allows declaring a specific date as Working, Holiday, or Half-Day for everyone
const CompanyDayOverrideSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    date: { type: Date, required: true }, // start of day (server local)
    type: {
      type: String,
      enum: ['WORKING', 'HOLIDAY', 'HALF_DAY'],
      required: true,
    },
    note: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

CompanyDayOverrideSchema.index({ company: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('CompanyDayOverride', CompanyDayOverrideSchema);

