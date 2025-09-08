const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    techStack: { type: [String], default: [] },
    teamLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    // Optional project start time/date
    startTime: { type: Date },
    // Personal projects are owned by a single employee and used for non-project tasks
    isPersonal: { type: Boolean, default: false },
    // Active flag: admins can deactivate finished projects
    active: { type: Boolean, default: true },
    // Estimated total time to complete (in minutes)
    estimatedTimeMinutes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
