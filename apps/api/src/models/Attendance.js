const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  firstPunchIn: { type: Date },
  lastPunchOut: { type: Date },
  lastPunchIn: { type: Date },
  firstPunchInLocation: { type: String },
  lastPunchInLocation: { type: String },
  workedMs: { type: Number, default: 0 },
  autoPunchOut: { type: Boolean, default: false },
  autoPunchOutAt: { type: Date },
  autoPunchLastIn: { type: Date },
  autoPunchResolvedAt: { type: Date },
  manualFillRequest: {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    requestedAt: { type: Date },
    status: {
      type: String,
      enum: ['PENDING', 'ACKED', 'COMPLETED', 'CANCELLED'],
      default: 'PENDING'
    },
    note: { type: String },
    adminNote: { type: String },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }
  },
  isDeleted: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
