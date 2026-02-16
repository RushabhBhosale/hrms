const mongoose = require("mongoose");

const AttendanceRequestSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true }, // start of day
    type: {
      type: String,
      enum: ["ADD", "EDIT"],
      default: "EDIT",
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    punchIn: { type: String, required: true }, // HH:mm (local/company tz)
    punchOut: { type: String, required: true }, // HH:mm (local/company tz)
    timezoneOffsetMinutes: { type: Number }, // minutes ahead of UTC at request time
    message: { type: String, default: "" },
    adminMessage: { type: String, default: "" },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AttendanceRequestSchema.index({ company: 1, status: 1, createdAt: -1 });
AttendanceRequestSchema.index({ employee: 1, date: 1, status: 1 });

module.exports = mongoose.model(
  "AttendanceRequest",
  AttendanceRequestSchema
);
