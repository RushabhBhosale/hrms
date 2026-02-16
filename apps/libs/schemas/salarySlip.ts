// src/lib/schemas/salarySlip.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const salarySlipSchema = z.object({
  employee: objectId,
  company: objectId,
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),
  values: "",
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type SalarySlipInput = z.infer<typeof salarySlipSchema>;
