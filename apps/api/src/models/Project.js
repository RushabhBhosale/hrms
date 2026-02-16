const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    techStack: { type: [String], default: [] },
    teamLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    // Optional project start time/date
    startTime: { type: Date },
    // Personal projects are owned by a single employee and used for non-project tasks
    isPersonal: { type: Boolean, default: false },
    // Active flag: admins can deactivate finished projects
    active: { type: Boolean, default: true },
    // New standardized active flag (kept alongside `active` for backward compatibility)
    isActive: { type: Boolean, default: true },
    // Estimated total time to complete (in minutes)
    estimatedTimeMinutes: { type: Number, default: 0, min: 0 },
    // Monthly time budget for the project (in minutes). 0 = no monthly cap.
    monthlyEstimateMinutes: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', ProjectSchema);
