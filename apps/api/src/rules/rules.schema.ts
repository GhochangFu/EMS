import { z } from "zod";

const categorySchema = z.enum(["comfort", "energy", "safety", "operations"]);
const ruleTypeSchema = z.enum(["threshold", "time_window"]);
const operatorSchema = z.enum(["gt", "gte", "lt", "lte", "eq"]);
const actionTypeSchema = z.enum(["notify", "review", "trace_only"]);
const daySchema = z.string().regex(/^(sun|mon|tue|wed|thu|fri|sat)$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ruleCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/),
);

const actionSchema = z.object({
  type: actionTypeSchema,
  target: z.string().min(2).max(128),
});

const latestConditionSchema = z.object({
  window: z.literal("latest"),
  unit: z.string().max(32).optional(),
});

const timeWindowConditionSchema = z.object({
  days: z.array(daySchema).min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
});

export const ruleDraftBodySchema = z.object({
  code: ruleCodeSchema.optional(),
  name: z.string().trim().min(3).max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  category: categorySchema.default("operations"),
  ruleType: ruleTypeSchema,
  assetId: z.string().uuid().nullable().optional(),
  pointKey: z.string().trim().min(1).max(128).nullable().optional(),
  operator: operatorSchema.nullable().optional(),
  thresholdValue: z.coerce.number().finite().nullable().optional(),
  severity: z.enum(["info", "warning", "critical"]).nullable().optional(),
  condition: z.union([latestConditionSchema, timeWindowConditionSchema]),
  action: actionSchema,
});

export const ruleUpdateBodySchema = ruleDraftBodySchema.partial().extend({
  reason: z.string().min(3).max(2000).optional(),
});

export const rulePreviewBodySchema = ruleDraftBodySchema.extend({
  id: z.string().uuid().optional(),
});

export const ruleLifecycleBodySchema = z.object({
  reason: z.string().min(3).max(2000).optional(),
});

export const ruleToggleBodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(3).max(2000).optional(),
});

export const listRuleExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type RuleToggleBody = z.infer<typeof ruleToggleBodySchema>;
export type RuleDraftBody = z.infer<typeof ruleDraftBodySchema>;
export type RuleUpdateBody = z.infer<typeof ruleUpdateBodySchema>;
export type RulePreviewBody = z.infer<typeof rulePreviewBodySchema>;
export type RuleLifecycleBody = z.infer<typeof ruleLifecycleBodySchema>;
export type ListRuleExecutionsQuery = z.infer<
  typeof listRuleExecutionsQuerySchema
>;
