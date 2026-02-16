const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
    title: { type: String, required: true },
    description: { type: String },
    assignedTo: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one assignee required",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "INPROGRESS", "DONE"],
      default: "PENDING",
    },
    // Priority for planning/order
    priority: {
      type: String,
      enum: ["URGENT", "FIRST", "SECOND", "LEAST"],
      default: "SECOND",
    },
    // Estimated time to complete the task (in minutes)
    estimatedTimeMinutes: { type: Number, default: 0, min: 0 },
    // Inline comments on the task
    comments: [
      {
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
          required: true,
        },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Time logging
    timeLogs: [
      {
        minutes: { type: Number, required: true, min: 1 },
        note: { type: String },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
          required: true,
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    timeSpentMinutes: { type: Number, default: 0, min: 0 },
    // System-created task for tracking meeting time; protected from deletion
    isMeetingDefault: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Task', TaskSchema);
