const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    primaryRole: { type: String, enum: ['SUPERADMIN', 'ADMIN', 'EMPLOYEE'], default: 'EMPLOYEE' },
    subRoles: { type: [String], default: [] },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    address: { type: String },
    phone: { type: String },
    dob: { type: Date },
    documents: { type: [String], default: [] },
    reportingPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    leaveBalances: {
      casual: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      unpaid: { type: Number, default: 0 },
      sick: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Employee', EmployeeSchema);
