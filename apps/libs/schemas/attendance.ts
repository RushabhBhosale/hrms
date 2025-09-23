// src/lib/schemas/attendance.ts
import * as z from "zod";

export const attendanceSchema = z.object({
  employee: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId"),
  date: z.coerce.date(),
  firstPunchIn: z.coerce.date().optional(),
  lastPunchOut: z.coerce.date().optional(),
  lastPunchIn: z.coerce.date().optional(),
  workedMs: z.number().min(0).optional(),
  autoPunchOut: z.boolean().optional(),
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;
