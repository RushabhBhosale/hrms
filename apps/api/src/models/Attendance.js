const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  firstPunchIn: { type: Date },
  lastPunchOut: { type: Date },
  lastPunchIn: { type: Date },
  workedMs: { type: Number, default: 0 }
});

AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
