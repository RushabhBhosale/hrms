const mongoose = require('mongoose');

const LineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 0 },
    rate: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 }, // computed, kept for quick reads
  },
  { _id: false }
);

const InvoiceSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
    type: { type: String, enum: ['receivable', 'payable'], required: true, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    sequenceKey: { type: String }, // internal: counter key used for this invoice number

    partyType: { type: String, enum: ['client', 'employee', 'vendor'], required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    partyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, // optional for employee
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' }, // optional for stored clients
    partyName: { type: String },
    partyEmail: { type: String },
    partyAddress: { type: String },

    issueDate: { type: Date, required: true },
    dueDate: { type: Date },
    paymentTerms: { type: String },

    status: {
      type: String,
      enum: ['draft', 'sent', 'pending', 'paid', 'overdue'],
      default: 'draft',
      index: true,
    },

    currency: { type: String, default: 'INR' },
    lineItems: { type: [LineItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0, index: true },

    notes: { type: String },
    attachments: { type: [String], default: [] }, // file keys for attachments
    pdfFile: { type: String }, // generated voucher/PDF file key
    partyLogo: { type: String }, // optional client logo file key
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', InvoiceSchema);
