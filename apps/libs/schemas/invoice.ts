// src/lib/schemas/invoice.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

export const invoiceLineItemSchema = z.object({
  description: nonEmptyString,
  quantity: nonNegativeNumber.optional(),
  rate: nonNegativeNumber.optional(),
  taxPercent: nonNegativeNumber.optional(),
  total: nonNegativeNumber.optional(),
});

export const invoiceSchema = z.object({
  company: objectId.optional(),
  type: z.enum(["receivable", "payable"]),
  invoiceNumber: nonEmptyString,
  sequenceKey: z.string().optional(),
  partyType: z.enum(["client", "employee", "vendor"]),
  project: objectId.optional(),
  partyId: objectId.optional(),
  partyName: z.string().optional(),
  partyEmail: z.string().optional(),
  partyAddress: z.string().optional(),
  issueDate: date,
  dueDate: date.optional(),
  paymentTerms: z.string().optional(),
  status: z.enum(["draft", "sent", "pending", "paid", "overdue"]).optional(),
  currency: z.string().optional(),
  lineItems: z.array(invoiceLineItemSchema).optional(),
  subtotal: nonNegativeNumber.optional(),
  taxTotal: nonNegativeNumber.optional(),
  totalAmount: nonNegativeNumber.optional(),
  notes: z.string().optional(),
  attachments: z.array(z.string()).optional(),
  pdfFile: z.string().optional(),
  partyLogo: z.string().optional(),
});

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
