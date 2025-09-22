// src/lib/schemas/masterState.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const masterStateSchema = z.object({
  name: z.string().min(1),
  nameKey: z.string().min(1),
  stateKey: z.string().min(1),
  countryKey: z.string().min(1),
  countryName: z.string().min(1),
  country: objectId,
  isoCode: z.string().optional(),
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
});

export type MasterStateInput = z.infer<typeof masterStateSchema>;
