const mongoose = require('mongoose');

// Per-employee, per-day overrides for reporting calculations
// Used to ignore half-days, late marks, or holidays for specific dates
const AttendanceOverrideSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true }, // start of day (server local)
    ignoreHalfDay: { type: Boolean, default: false },
    ignoreLate: { type: Boolean, default: false },
    ignoreHoliday: { type: Boolean, default: false },
    reason: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

AttendanceOverrideSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceOverride', AttendanceOverrideSchema);

