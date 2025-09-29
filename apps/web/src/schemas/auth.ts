import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be more than 5 characters"),
});

export type LoginValues = z.output<typeof LoginSchema>;
