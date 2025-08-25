const mongoose = require('mongoose');

const LeaveSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    adminMessage: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Leave', LeaveSchema);
