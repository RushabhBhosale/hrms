const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    roles: { type: [String], default: ['hr', 'manager', 'developer'] },
    leavePolicy: {
      casual: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      sick: { type: Number, default: 0 }
    },
    bankHolidays: [
      {
        date: { type: Date, required: true },
        name: { type: String }
      }
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Company', CompanySchema);
