import { ruleCategoryCodeSchema } from "@bms/shared";
import { z } from "zod";

/**
 * The three enums below are exported because ADR 0019 §3 binds a template's
 * `content.alarms` to this vocabulary rather than restating it — a copied enum
 * is a copy that drifts, and a template that authors `neq` or `major` would be
 * authoring alarms this engine cannot run. Everything else here stays private.
 */

/**
 * A rule's **concern** (ADR 0031) — shape only.
 *
 * This was an enum until Amendment 1 made the vocabulary data. It now checks
 * that a code is a plausible code; that it is a *live* one is checked by
 * `RulesService` against `bms.rule_categories`, and closed absolutely by
 * `automation_rules_category_fk`.
 *
 * It is still re-exported from `@bms/shared` rather than declared here, which
 * matters more now than it did: ADR 0019 §3 binds template `content.alarms` to
 * the same vocabulary, and the two must not drift into different notions of
 * what a category even looks like.
 *
 * **It used to be narrower than what the API returns**, by `electrical` — the
 * value migration 0022 wrote directly on the PHE pilot's 48 rules (`F4.43`).
 * That asymmetry is gone: `electrical` is a plant domain, it moved to the
 * asset, and migration `0029` reclassified those rows.
 */
export const categorySchema = ruleCategoryCodeSchema;
const ruleTypeSchema = z.enum(["threshold", "time_window"]);
export const operatorSchema = z.enum(["gt", "gte", "lt", "lte", "eq"]);
export const severitySchema = z.enum(["info", "warning", "critical"]);
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
  severity: severitySchema.nullable().optional(),
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
