// src/lib/schemas/salaryTemplate.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

export const salaryTemplateFieldSchema = z.object({
  key: nonEmptyString,
  label: nonEmptyString,
  type: z.enum(["text", "number", "date"]).optional(),
  required: z.boolean().optional(),
  locked: z.boolean().optional(),
  category: z.enum(["earning", "deduction", "info"]).optional(),
  amountType: z.enum(["fixed", "percent"]).optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().optional(),
});

export const salaryTemplateSchema = z.object({
  company: objectId,
  fields: z.array(salaryTemplateFieldSchema).optional(),
  settings: z
    .object({
      basicPercent: nonNegativeNumber.optional(),
      hraPercent: nonNegativeNumber.optional(),
      medicalAmount: nonNegativeNumber.optional(),
    })
    .optional(),
  updatedBy: objectId.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type SalaryTemplateFieldInput = z.infer<
  typeof salaryTemplateFieldSchema
>;
export type SalaryTemplateInput = z.infer<typeof salaryTemplateSchema>;
