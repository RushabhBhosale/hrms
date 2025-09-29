import { z } from "zod";

export const CompanyCreateSchema = z.object({
  companyName: z.string().trim().min(2, "Enter company name"),
  adminName: z.string().trim().min(2, "Enter admin name"),
  adminEmail: z.string().trim().email("Invalid email"),
  adminPassword: z.string().min(6, "Min 6 characters"),
  countryId: z.string().min(1, "Select country"),
  stateId: z.string().min(1, "Select state"),
  cityId: z.string().min(1, "Select city"),
  companyTypeId: z.string().min(1, "Select company type"),
});

export type CompanyCreateValues = z.infer<typeof CompanyCreateSchema>;
