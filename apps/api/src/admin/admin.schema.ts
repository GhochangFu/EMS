import { z } from "zod";

export const activeFilterSchema = z.enum(["true", "false", "all"]).default("all");

export const idParamSchema = z.string().uuid();

export function parseActiveFilter(value: string | undefined): boolean | undefined {
  const parsed = activeFilterSchema.parse(value ?? "all");
  if (parsed === "all") {
    return undefined;
  }
  return parsed === "true";
}
