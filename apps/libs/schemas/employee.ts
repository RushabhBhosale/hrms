// src/lib/schemas/employee.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

export const employeeBankDetailsSchema = z
  .object({
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifsc: z.string().optional(),
  })
  .optional();

export const employeeLeaveBalanceSchema = z
  .object({
    casual: nonNegativeNumber.optional(),
    paid: nonNegativeNumber.optional(),
    unpaid: nonNegativeNumber.optional(),
    sick: nonNegativeNumber.optional(),
  })
  .optional();

export const employeeLeaveUsageSchema = z
  .object({
    paid: nonNegativeNumber.optional(),
    casual: nonNegativeNumber.optional(),
    sick: nonNegativeNumber.optional(),
    unpaid: nonNegativeNumber.optional(),
  })
  .optional();

export const employeeLeaveAccrualSchema = z
  .object({
    lastAccruedYearMonth: z.string().optional(),
  })
  .optional();

export const employeeSchema = z.object({
  name: nonEmptyString,
  email: nonEmptyString,
  passwordHash: nonEmptyString,
  primaryRole: z.enum(["SUPERADMIN", "ADMIN", "EMPLOYEE"]).optional(),
  subRoles: z.array(z.string()).optional(),
  company: objectId.optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  dob: date.optional(),
  employeeId: z.string().optional(),
  aadharNumber: z.string().optional(),
  panNumber: z.string().optional(),
  bankDetails: employeeBankDetailsSchema,
  ctc: nonNegativeNumber.optional(),
  documents: z.array(z.string()).optional(),
  reportingPerson: objectId.optional(),
  leaveBalances: employeeLeaveBalanceSchema,
  totalLeaveAvailable: nonNegativeNumber.optional(),
  leaveUsage: employeeLeaveUsageSchema,
  leaveAccrual: employeeLeaveAccrualSchema,
  resetOtpHash: z.string().optional(),
  resetOtpExpires: date.optional(),
  resetOtpAttempts: nonNegativeNumber.optional(),
  resetOtpLastSentAt: date.optional(),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
