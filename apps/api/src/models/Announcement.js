const mongoose = require("mongoose");
const { fieldEncryption } = require("mongoose-field-encryption");

const AnnouncementSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    expiresAt: { type: Date },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  { timestamps: true }
);

// 🔑 Must be a 32-char string for AES-256
const secret = process.env.ENC_KEY || "12345678901234567890123456789012";

// Encrypt only sensitive fields
AnnouncementSchema.plugin(fieldEncryption, {
  fields: ["title", "message"], // encrypt the content
  secret,
});

module.exports = mongoose.model("Announcement", AnnouncementSchema);
