const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    type: { type: String, default: "MAIL", index: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    /**
     * App-relative route without shell prefix.
     * Example: "/projects/<id>/tasks?comments=<taskId>"
     */
    link: { type: String, default: "" },
    readAt: { type: Date, default: null, index: true },
    meta: { type: mongoose.Schema.Types.Mixed },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ employee: 1, createdAt: -1 });
NotificationSchema.index({ employee: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
