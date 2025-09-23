// src/lib/schemas/masterCity.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const masterCitySchema = z.object({
  name: z.string().min(1),
  nameKey: z.string().min(1),
  cityKey: z.string().min(1),
  stateKey: z.string().min(1),
  stateName: z.string().min(1),
  state: objectId,
  countryKey: z.string().min(1),
  countryName: z.string().min(1),
  country: objectId,
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
});

export type MasterCityInput = z.infer<typeof masterCitySchema>;
