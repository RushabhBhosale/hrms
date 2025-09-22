// src/lib/schemas/company.ts
import * as z from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");
const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);

// Sub-schemas
export const companyRequestedAdminSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    passwordHash: z.string().optional(),
    passwordPlain: z.string().optional(),
    requestedAt: date.optional(),
  })
  .optional();

export const companyLocationSchema = z
  .object({
    country: objectId.optional(),
    countryName: z.string().optional(),
    state: objectId.optional(),
    stateName: z.string().optional(),
    city: objectId.optional(),
    cityName: z.string().optional(),
  })
  .optional();

export const companyLeavePolicySchema = z
  .object({
    totalAnnual: nonNegativeNumber.optional(),
    ratePerMonth: nonNegativeNumber.optional(),
    typeCaps: z
      .object({
        paid: nonNegativeNumber.optional(),
        casual: nonNegativeNumber.optional(),
        sick: nonNegativeNumber.optional(),
      })
      .optional(),
  })
  .optional();

export const companyWorkHoursSchema = z
  .object({
    start: z.string().optional(),
    end: z.string().optional(),
    graceMinutes: nonNegativeNumber.optional(),
  })
  .optional();

export const companyBankHolidaySchema = z.object({
  date,
  name: z.string().optional(),
});

export const companyThemeSchema = z
  .object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
    success: z.string().optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  })
  .optional();

// Main schema
export const companySchema = z.object({
  name: nonEmptyString,
  admin: objectId.optional(),
  logo: z.string().optional(),
  logoSquare: z.string().optional(),
  logoHorizontal: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  requestedAdmin: companyRequestedAdminSchema,
  location: companyLocationSchema,
  companyType: objectId.optional(),
  companyTypeName: z.string().optional(),
  roles: z.array(z.string()).optional(),
  leavePolicy: companyLeavePolicySchema,
  workHours: companyWorkHoursSchema,
  bankHolidays: z.array(companyBankHolidaySchema).optional(),
  theme: companyThemeSchema,
});

export type CompanyInput = z.infer<typeof companySchema>;
