// src/lib/schemas/companyTypeMaster.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const companyTypeMasterSchema = z.object({
  name: z.string().min(1),
  nameKey: z.string().min(1),
  description: z.string().optional(),
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CompanyTypeMasterInput = z.infer<typeof companyTypeMasterSchema>;
