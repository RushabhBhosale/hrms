const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    description: { type: String },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    status: { type: String, enum: ['PENDING', 'INPROGRESS', 'DONE'], default: 'PENDING' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Task', TaskSchema);
