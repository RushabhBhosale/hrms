const mongoose = require('mongoose');
const encrypt = require('mongoose-encryption');

const LeaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    type: {
      type: String,
      enum: ['CASUAL', 'PAID', 'UNPAID', 'SICK'],
      required: true,
    },
    // Optional fallback type to use when selected type balance is insufficient
    fallbackType: { type: String, enum: ['PAID', 'SICK', 'UNPAID', null], default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    adminMessage: { type: String },
    // Allocation snapshot applied at approval time
    allocations: {
      paid: { type: Number, default: 0 },
      casual: { type: Number, default: 0 },
      sick: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// ---- Encryption plugin ----
const encKey = process.env.ENC_KEY; // 32-byte key (base64)
if (!encKey) {
  console.warn('⚠️ ENC_KEY not set — Leave.reason/adminMessage will NOT be encrypted!');
}

LeaveSchema.plugin(encrypt, {
  secret: encKey,
  encryptedFields: ['reason', 'adminMessage'],
  requireAuthenticationCode: false,
});

module.exports = mongoose.model('Leave', LeaveSchema);
