const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    primaryRole: { type: String, enum: ['SUPERADMIN', 'ADMIN', 'USER'], default: 'USER' },
    subRoles: { type: [String], default: [] },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
