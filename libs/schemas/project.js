const { z } = require("zod");

const projectSchema = z.object({
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title is required"),
  description: z
    .union([
      z.string({ invalid_type_error: "Description must be a string" }),
      z.null(),
      z.undefined(),
    ])
    .transform((val) => (val == null ? undefined : val)),
  techStack: z
    .array(z.string().trim().min(1, "Tech stack entries cannot be empty"))
    .optional()
    .default([]),
  teamLead: z
    .string({ required_error: "Team lead is required" })
    .trim()
    .min(1, "Team lead is required"),
  members: z
    .array(z.string().trim().min(1, "Member id cannot be empty"))
    .optional()
    .default([]),
  company: z
    .string({ required_error: "Company is required" })
    .trim()
    .min(1, "Company is required"),
  client: z
    .union([z.string().trim().min(1, "Client id cannot be empty"), z.undefined()])
    .optional()
    .transform((val) => (val == null || val === "" ? undefined : val)),
  startTime: z.date().optional(),
  estimatedTimeMinutes: z
    .number({ invalid_type_error: "Estimated time must be a number" })
    .int("Estimated time must be an integer")
    .min(0, "Estimated time cannot be negative")
    .optional()
    .default(0),
  monthlyEstimateMinutes: z
    .number({ invalid_type_error: "Monthly estimate must be a number" })
    .int("Monthly estimate must be an integer")
    .min(0, "Monthly estimate cannot be negative")
    .optional()
    .default(0),
});

module.exports = { projectSchema };
