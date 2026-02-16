const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: '', trim: true },
    cost: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED'],
      default: 'AVAILABLE',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    purchaseDate: { type: Date },
    notes: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

InventoryItemSchema.index({ company: 1, name: 1, createdAt: -1 });
InventoryItemSchema.index({ company: 1, assignedTo: 1 });

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);
