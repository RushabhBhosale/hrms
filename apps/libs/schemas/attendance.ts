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
  autoPunchOutAt: z.coerce.date().optional(),
  autoPunchLastIn: z.coerce.date().optional(),
  autoPunchResolvedAt: z.coerce.date().optional(),
  manualFillRequest: z
    .object({
      requestedBy: z.string().optional(),
      requestedAt: z.coerce.date().optional(),
      status: z
        .enum(["PENDING", "ACKED", "COMPLETED", "CANCELLED"])
        .optional(),
      note: z.string().optional(),
      adminNote: z.string().optional(),
      acknowledgedAt: z.coerce.date().optional(),
      resolvedAt: z.coerce.date().optional(),
      resolvedBy: z.string().optional(),
    })
    .optional(),
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;
