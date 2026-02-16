const { z } = require("zod");

const optionalString = (opts = {}) =>
  z
    .union([
      z.string({ invalid_type_error: opts.invalid || "Invalid value" }).trim(),
      z.undefined(),
      z.null(),
    ])
    .transform((val) => {
      if (val === undefined || val === null) return undefined;
      const trimmed = String(val).trim();
      return trimmed.length ? trimmed : undefined;
    });

const clientSchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required"),
  email: optionalString({ invalid: "Email must be a string" }).refine(
    (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    "Invalid email"
  ),
  phone: optionalString(),
  address: optionalString(),
  notes: optionalString(),
});

module.exports = { clientSchema };
