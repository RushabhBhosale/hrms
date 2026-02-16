// src/lib/schemas/expenseCategory.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const expenseCategorySchema = z.object({
  company: objectId,
  name: z.string().min(1),
  isDefault: z.boolean().optional(),
  createdBy: objectId.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
