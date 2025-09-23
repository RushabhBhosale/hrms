// src/lib/schemas/attendanceOverride.ts
import * as z from "zod";

export const attendanceOverrideSchema = z.object({
  employee: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId"),
  date: z.coerce.date(),
  ignoreHalfDay: z.boolean().optional(),
  ignoreLate: z.boolean().optional(),
  ignoreHoliday: z.boolean().optional(),
  reason: z.string().optional(),
  updatedBy: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid ObjectId")
    .optional(),
});

export type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;
