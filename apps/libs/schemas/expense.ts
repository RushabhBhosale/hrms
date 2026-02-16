// src/lib/schemas/expense.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

export const expenseRecurringSchema = z
  .object({
    frequency: z
      .enum(["daily", "weekly", "monthly", "quarterly", "yearly"])
      .optional(),
    startDate: date.optional(),
    nextDueDate: date.optional(),
    reminderDaysBefore: nonNegativeNumber.optional(),
  })
  .optional();

export const expenseVoucherSchema = z
  .object({
    number: z.string().optional(),
    authorizedBy: z.string().optional(),
    sequenceKey: z.string().optional(),
    pdfFile: z.string().optional(),
    generatedAt: date.optional(),
  })
  .optional();

export const expenseSchema = z.object({
  company: objectId,
  date,
  category: objectId,
  categoryName: nonEmptyString,
  description: z.string().optional(),
  notes: z.string().optional(),
  amount: nonNegativeNumber,
  paidBy: z.enum(["cash", "bank", "upi", "card"]),
  attachments: z.array(z.string()).optional(),
  isRecurring: z.boolean().optional(),
  recurring: expenseRecurringSchema,
  hasVoucher: z.boolean().optional(),
  voucher: expenseVoucherSchema,
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
