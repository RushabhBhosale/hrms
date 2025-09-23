const { z } = require("zod");

const recurringSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),
    startDate: z.date(),
    nextDueDate: z.date().nullable().optional(),
    reminderDaysBefore: z
      .number({ invalid_type_error: "Reminder days must be a number" })
      .int("Reminder days must be an integer")
      .min(0, "Reminder days cannot be negative")
      .optional()
      .default(0),
  })
  .optional()
  .nullable();

const voucherSchema = z
  .object({
    number: z
      .string({ required_error: "Voucher number is required" })
      .trim()
      .min(1, "Voucher number is required"),
    authorizedBy: z.string().trim().optional(),
    sequenceKey: z
      .string({ required_error: "Voucher sequence key is required" })
      .trim()
      .min(1, "Voucher sequence key is required"),
    pdfFile: z.string().trim().optional(),
    generatedAt: z.date(),
  })
  .optional()
  .nullable();

const stringField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val) => (val == null ? "" : String(val)));

const idField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val) => (val == null ? undefined : String(val).trim()))
  .refine((val) => val === undefined || val.length > 0, {
    message: "Id cannot be empty",
  });

const expenseSchema = z.object({
  company: z
    .string({ required_error: "Company is required" })
    .trim()
    .min(1, "Company is required"),
  date: z.date({ required_error: "Date is required" }),
  category: z
    .string({ required_error: "Category is required" })
    .trim()
    .min(1, "Category is required"),
  categoryName: z
    .string({ required_error: "Category name is required" })
    .trim()
    .min(1, "Category name is required"),
  description: stringField,
  notes: stringField,
  amount: z
    .number({ required_error: "Amount is required" })
    .nonnegative("Amount must be non-negative"),
  paidBy: z.enum(["cash", "bank", "upi", "card"], {
    required_error: "Payment mode is required",
    invalid_type_error: "Payment mode is invalid",
  }),
  attachments: z
    .array(z.string().trim().min(1, "Attachment file name cannot be empty"))
    .optional()
    .default([]),
  isRecurring: z.boolean().optional().default(false),
  recurring: recurringSchema,
  hasVoucher: z.boolean().optional().default(false),
  voucher: voucherSchema,
  createdBy: idField,
  updatedBy: idField,
});

module.exports = { expenseSchema };
