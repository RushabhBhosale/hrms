const { Schema } = require("mongoose");
const { z } = require("zod");

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId");

const date = z.coerce.date();
const nonEmptyString = z.string().min(1);
const nonNegativeNumber = z.number().min(0);
const positiveInt = z.number().int().min(1);

const taskCommentSchema = z.object({
  author: objectId,
  text: nonEmptyString,
  createdAt: date.optional(),
});

const taskTimeLogSchema = z.object({
  minutes: positiveInt,
  note: z.string().optional(),
  addedBy: objectId,
  createdAt: date.optional(),
});

const taskSchema = z.object({
  project: objectId,
  title: nonEmptyString,
  description: z.string().optional(),
  assignedTo: z.union([objectId, z.array(objectId).nonempty()]),
  createdBy: objectId,
  status: z.enum(["PENDING", "INPROGRESS", "DONE"]).optional(),
  priority: z.enum(["URGENT", "FIRST", "SECOND", "LEAST"]).optional(),
  estimatedTimeMinutes: nonNegativeNumber.optional(),
  comments: z.array(taskCommentSchema).optional(),
  timeLogs: z.array(taskTimeLogSchema).optional(),
  timeSpentMinutes: nonNegativeNumber.optional(),
  isDeleted: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  taskSchema,
  taskCommentSchema,
  taskTimeLogSchema,
};
