import { z } from "zod";

import { automationRuleOperatorSchema, ruleCategoryCodeSchema } from "./operations";

/**
 * `E2.4` / ADR 0058 — the seeded-rules drift and re-apply contracts.
 *
 * Split out of `admin.ts` on §4.5 file-size grounds (that file was already at
 * its 1000-line cap), not because these belong to a different surface — the
 * two new routes are still `admin/asset-templates/:id/seeded-rules*`.
 */

/**
 * The values a template alarm resolves to when seeded — `operator` and
 * `thresholdValue` both `null` for a philosophy row (ADR 0058 decision 3),
 * both set for a proto-rule (decision 4). One declaration, reused for three
 * roles per ADR 0058 decision 5/8: `live` (the rule's current columns),
 * `seededBaseline` (what it was seeded with, ADR 0058 decision 5's
 * `seeded_baseline` jsonb), and `current` (what the template's presently
 * published version would seed today).
 */
export const seededRuleValuesSchema = z.object({
  operator: automationRuleOperatorSchema.nullable(),
  thresholdValue: z.number().nullable(),
  severity: z.string().nullable(),
  category: ruleCategoryCodeSchema,
  message: z.string(),
});

/**
 * ADR 0058 decision 8 — how a live seeded rule compares against the
 * template's currently published version. `in_sync`: live matches both
 * baseline and current. `local_override`: an engineer changed the live rule
 * and the template has not moved. `template_moved`: the template's current
 * values differ from the baseline the rule was seeded with, but the live rule
 * is unchanged. `both_moved`: both differ, and from each other.
 */
export const seededRuleDriftVerdictSchema = z.enum([
  "in_sync",
  "local_override",
  "template_moved",
  "both_moved",
]);

/** One row of `GET /admin/asset-templates/:id/seeded-rules` (ADR 0058 decision 8). */
export const seededRuleDtoSchema = z.object({
  ruleId: z.string(),
  ruleCode: z.string(),
  enabled: z.boolean(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  locationId: z.string(),
  sourceTemplateId: z.string(),
  sourceTemplateVersion: z.number().int(),
  sourceAlarmCode: z.string(),
  live: seededRuleValuesSchema,
  seededBaseline: seededRuleValuesSchema,
  /**
   * `null` when the current published version no longer carries
   * `sourceAlarmCode` (ADR 0058 D5) — the alarm was removed since this rule
   * was seeded, so there is nothing to compare against or re-apply from.
   */
  current: seededRuleValuesSchema.nullable(),
  verdict: seededRuleDriftVerdictSchema,
});

/** `GET /admin/asset-templates/:id/seeded-rules` (ADR 0058 decision 8). */
export const seededRulesListResponseSchema = z.object({
  templateCode: z.string(),
  currentVersion: z
    .object({
      id: z.string(),
      version: z.number().int(),
    })
    .nullable(),
  items: z.array(seededRuleDtoSchema),
});

/** `POST /admin/asset-templates/:id/seeded-rules/reapply` (ADR 0058 decision 6). */
export const reapplySeededRulesResponseSchema = z.object({
  appliedVersion: z.number().int(),
  items: z.array(seededRuleDtoSchema),
});
