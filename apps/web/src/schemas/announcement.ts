import { z } from "zod";

const dateIsValid = (value: string) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const announcementFormSchema = z.object({
  title: z
    .string()
    .trim()
    .nonempty("Title is required")
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title must be at most 120 characters"),
  message: z
    .string()
    .trim()
    .nonempty("Message is required")
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be at most 5000 characters"),
  expiresAt: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .refine(dateIsValid, "Enter a valid expiration date"),
    ])
    .optional(),
});

export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;
