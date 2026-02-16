import * as z from "zod";

export const announcementSchema = z.object({
  company: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId"),
  title: z.string().min(1),
  message: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
  createdBy: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId"),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;
