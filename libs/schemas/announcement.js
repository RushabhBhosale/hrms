const { z } = require("zod");

const objectIdString = z
  .string({ required_error: "Identifier is required" })
  .trim()
  .min(1, "Identifier is required");

const expiresAtField = z
  .preprocess(
    (value) => {
      if (value === "" || value === null || typeof value === "undefined") {
        return undefined;
      }
      return value;
    },
    z.union([
      z.date(),
      z
        .string()
        .trim()
        .refine(
          (value) => !Number.isNaN(new Date(value).getTime()),
          { message: "Expires at must be a valid date" },
        )
        .transform((value) => new Date(value)),
    ]),
  )
  .optional();

const announcementSchema = z.object({
  company: objectIdString,
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title must be at most 120 characters"),
  message: z
    .string({ required_error: "Message is required" })
    .trim()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be at most 5000 characters"),
  expiresAt: expiresAtField,
  createdBy: objectIdString,
});

module.exports = {
  announcementSchema,
};
