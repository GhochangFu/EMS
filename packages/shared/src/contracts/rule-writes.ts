import { z } from "zod";

import {
  automationRuleOperatorSchema,
  automationRuleSeveritySchema,
  DEFAULT_RULE_CATEGORY_CODE,
  ruleCategoryCodeSchema,
} from "./operations";

/**
 * `F4.278` (ADR 0099 Amendment 8, ADR 0030) — the request bodies of the
 * alarm-rule write routes (`apps/api/src/rules/rules.controller.ts`), moved
 * here from `apps/api/src/rules/rules.schema.ts` so the copilot catalog entries
 * carry the route's own body by identity. `rules.schema.ts` keeps the three
 * vocabulary re-exports ADR 0019 §3 binds, the preview body (an excluded route)
 * and the executions query.
 */

const ruleTypeSchema = z.enum(["threshold", "time_window"]);
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

const actionSchema = z
  .object({
    type: actionTypeSchema,
    target: z.string().min(2).max(128),
  })
  .strict();

const latestConditionSchema = z
  .object({
    window: z.literal("latest"),
    unit: z.string().max(32).optional(),
  })
  .strict();

const timeWindowConditionSchema = z
  .object({
    days: z.array(daySchema).min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .strict();

/** The fields of a rule draft, shared by the route's body and the copilot's create model body. */
const ruleDraftShape = {
  code: ruleCodeSchema.optional(),
  name: z.string().trim().min(3).max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  category: ruleCategoryCodeSchema.default(DEFAULT_RULE_CATEGORY_CODE),
  ruleType: ruleTypeSchema,
  assetId: z.string().uuid().nullable().optional(),
  pointKey: z.string().trim().min(1).max(128).nullable().optional(),
  operator: automationRuleOperatorSchema.nullable().optional(),
  thresholdValue: z.coerce.number().finite().nullable().optional(),
  severity: automationRuleSeveritySchema.nullable().optional(),
  // `F3.10` ruling Q2 — one second to twenty-four hours. `0` is refused
  // because a zero hold is no hold at all, and `null` already means "the
  // default", which is applied where the value is consumed rather than
  // substituted here (see `rule-mapping.ts`).
  clearHoldSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
  condition: z.union([latestConditionSchema, timeWindowConditionSchema]),
  action: actionSchema,
};

/** `POST /rules` — a new draft. */
export const ruleDraftBodySchema = z.object(ruleDraftShape).strict();

/** `PATCH /rules/:id` — every draft field optional, plus a reason. `.strict()` survives `.partial().extend()`. */
export const ruleUpdateBodySchema = ruleDraftBodySchema.partial().extend({
  reason: z.string().min(3).max(2000).optional(),
});

/** `POST /rules/:id/publish`, `/duplicate`, `/archive` — an optional reason alone. */
export const ruleLifecycleBodySchema = z
  .object({
    reason: z.string().min(3).max(2000).optional(),
  })
  .strict();

/** `PATCH /rules/:id/enabled` — the direction, plus an optional reason. */
export const ruleToggleBodySchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().min(3).max(2000).optional(),
  })
  .strict();

/**
 * The copilot's model body for `rule.create` (Amendment 8 D2): the route's own
 * draft with `assetId` required. The route itself refuses an asset-less rule
 * with a 400, and the resolver derives the organization from the asset, so the
 * model never proposes one.
 */
export const copilotRuleCreateModelBodySchema = z
  .object({ ...ruleDraftShape, assetId: z.string().uuid() })
  .strict();

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the most rules one batch carries. One
 * card proposes at most this many; a site that needs more gets the next card
 * after the user confirms or rejects the open one.
 */
export const RULE_BATCH_MAX_ROWS = 25;

/**
 * `POST /rules/batch` — up to 25 drafts, created and published in one
 * transaction, all or none. `excludedRows` is the card's unticked rows (0-based
 * indexes into `rules`); it is the entry's `clientOnly` field, so the change
 * hash binds `rules` alone and the user can only leave a row out, never add or
 * change one. Each row is the route's own draft body by reference.
 */
export const ruleBatchBodySchema = z
  .object({
    rules: z.array(ruleDraftBodySchema).min(1).max(RULE_BATCH_MAX_ROWS),
    excludedRows: z
      .array(z.number().int().min(0).max(RULE_BATCH_MAX_ROWS - 1))
      .max(RULE_BATCH_MAX_ROWS)
      .optional(),
  })
  .strict();

/**
 * The copilot's model body for `rule.createBatch`: every row is the
 * `rule.create` model body (asset required), and the strict object refuses
 * `excludedRows` — only the user's ticks send it.
 */
export const copilotRuleBatchModelBodySchema = z
  .object({
    rules: z.array(copilotRuleCreateModelBodySchema).min(1).max(RULE_BATCH_MAX_ROWS),
  })
  .strict();

export type RuleDraftBody = z.infer<typeof ruleDraftBodySchema>;
export type RuleUpdateBody = z.infer<typeof ruleUpdateBodySchema>;
export type RuleLifecycleBody = z.infer<typeof ruleLifecycleBodySchema>;
export type RuleToggleBody = z.infer<typeof ruleToggleBodySchema>;
export type RuleBatchBody = z.infer<typeof ruleBatchBodySchema>;
