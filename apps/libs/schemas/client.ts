// src/lib/schemas/client.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

export const clientSchema = z.object({
  company: objectId.optional(),
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().url("Enter a valid URL").optional(),
  logo: z.string().optional(),
  logoUrl: z.string().url("Enter a valid URL").optional(),
  pointOfContact: z.string().optional(),
  pointEmail: z.string().email().optional(),
  pointPhone: z.string().optional(),
  bio: z.string().optional(),
  notes: z.string().optional(),
  isDeleted: z.boolean().optional(),
});

export type ClientInput = z.infer<typeof clientSchema>;
