// src/lib/schemas/project.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

export const projectSchema = z.object({
  title: nonEmptyString,
  description: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  teamLead: objectId,
  members: z.array(objectId).optional(),
  company: objectId.optional(),
  startTime: date.optional(),
  isPersonal: z.boolean().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  estimatedTimeMinutes: nonNegativeNumber.optional(),
});

export type ProjectInput = z.infer<typeof projectSchema>;
