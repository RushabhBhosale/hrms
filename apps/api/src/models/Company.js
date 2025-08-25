const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Company', CompanySchema);
