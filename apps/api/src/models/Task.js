const mongoose = require('mongoose');
const encrypt = require('mongoose-encryption');

  const TaskSchema = new mongoose.Schema(
    {
      project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
      title: { type: String, required: true },
      description: { type: String },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
      status: { type: String, enum: ['PENDING', 'INPROGRESS', 'DONE'], default: 'PENDING' },
      // Priority for planning/order
      priority: {
        type: String,
        enum: ['URGENT', 'FIRST', 'SECOND', 'LEAST'],
        default: 'SECOND',
      },
      // Estimated time to complete the task (in minutes)
      estimatedTimeMinutes: { type: Number, default: 0, min: 0 },
      // Inline comments on the task
      comments: [
        {
          author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
          text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Time logging
    timeLogs: [
      {
        minutes: { type: Number, required: true, min: 1 },
        note: { type: String },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    timeSpentMinutes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// ---- Encryption plugin ----
const encKey = process.env.ENC_KEY; // 32-byte key (base64)
if (!encKey) {
  console.warn('⚠️ ENC_KEY not set — Task comments/time log notes will NOT be encrypted!');
}

// Encrypt free-text fields that may contain sensitive details
TaskSchema.plugin(encrypt, {
  secret: encKey,
  encryptedFields: ['timeLogs.note', 'description'],
  requireAuthenticationCode: false,
});

module.exports = mongoose.model('Task', TaskSchema);
