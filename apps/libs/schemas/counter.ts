// src/lib/schemas/counter.ts
import * as z from "zod";

export const counterSchema = z.object({
  key: z.string().min(1),
  seq: z.number().min(0).optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CounterInput = z.infer<typeof counterSchema>;
