// src/lib/schemas/companyDayOverride.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const companyDayOverrideSchema = z.object({
  company: objectId,
  date: z.coerce.date(),
  type: z.enum(["WORKING", "HOLIDAY", "HALF_DAY"]),
  note: z.string().optional(),
  updatedBy: objectId.optional(),
});

export type CompanyDayOverrideInput = z.infer<typeof companyDayOverrideSchema>;
