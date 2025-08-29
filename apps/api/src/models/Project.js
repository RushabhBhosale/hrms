const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    techStack: { type: [String], default: [] },
    teamLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    // Personal projects are owned by a single employee and used for non-project tasks
    isPersonal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
