import { z } from "zod";

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "At most 100 characters");

export const projectIdSchema = z.uuid("Invalid project");

export const createProjectSchema = z.object({ name: projectNameSchema });

export const renameProjectSchema = z.object({
  id: projectIdSchema,
  name: projectNameSchema,
});

export const archiveProjectSchema = z.object({
  id: projectIdSchema,
  archived: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export const deleteProjectSchema = z.object({ id: projectIdSchema });
