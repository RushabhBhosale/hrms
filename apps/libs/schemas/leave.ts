// src/lib/schemas/leave.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonNegativeNumber = z.number().min(0);

export const leaveAllocationsSchema = z
  .object({
    paid: nonNegativeNumber.optional(),
    casual: nonNegativeNumber.optional(),
    sick: nonNegativeNumber.optional(),
    unpaid: nonNegativeNumber.optional(),
  })
  .optional();

export const leaveSchema = z.object({
  employee: objectId,
  company: objectId,
  approver: objectId.optional(),
  type: z.enum(["CASUAL", "PAID", "UNPAID", "SICK"]),
  fallbackType: z.enum(["PAID", "SICK", "UNPAID"]).nullable().optional(),
  startDate: date,
  endDate: date,
  reason: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  adminMessage: z.string().optional(),
  allocations: leaveAllocationsSchema,
});

export type LeaveAllocationsInput = z.infer<typeof leaveAllocationsSchema>;
export type LeaveInput = z.infer<typeof leaveSchema>;
