import {
  automationRuleOperatorSchema,
  automationRuleSeveritySchema,
  ruleCategoryCodeSchema,
  ruleDraftBodySchema,
} from "@bms/shared";
import { z } from "zod";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

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
/**
 * A threshold rule's comparison. Re-exported from `@bms/shared`'s
 * `automationRuleOperatorSchema` rather than declared here since `F3.85`
 * PR 11a: the template `content.alarms` contract moved to `packages/shared`
 * and binds the same vocabulary, and a second `z.enum` would be a copy that
 * drifts. The five values and their order are unchanged.
 */
export const operatorSchema = automationRuleOperatorSchema;
/**
 * A rule's severity (ADR 0032) — shape only, and re-exported rather than
 * declared here for the same reason `categorySchema` is.
 *
 * This was an enum until ADR 0032 made the vocabulary data. It now checks that
 * a code is a plausible code; that it is a *live* one is checked by
 * `VocabulariesService.assertAlarmSeverity`, and closed absolutely by
 * `alarms_severity_fk` and `automation_rules_severity_fk`.
 *
 * ADR 0019 §3 binds template `content.alarms` to this same vocabulary, so the
 * two must not drift into different notions of what a severity even looks like
 * — which is why the template path gained its own `assertAlarmSeverity` call
 * when this stopped rejecting unknown values by itself.
 */
export const severitySchema = automationRuleSeveritySchema;
/**
 * `POST /rules/preview` — the draft plus an optional id. It stays here, api-only:
 * the route is on the copilot's exclusion list (it writes a `rule_preview` audit
 * row), so no catalog entry carries it. The draft and the four write bodies moved
 * to `@bms/shared` (`F4.278`, ADR 0030 — `packages/shared/src/contracts/rule-writes.ts`).
 */
export const rulePreviewBodySchema = ruleDraftBodySchema.extend({
  id: z.string().uuid().optional(),
});

export const listRuleExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type RulePreviewBody = z.infer<typeof rulePreviewBodySchema>;
export type ListRuleExecutionsQuery = z.infer<
  typeof listRuleExecutionsQuerySchema
>;

/**
 * `F4.361` U5 (ADR 0132 decision 4, plan D7) — `GET /rules?organizationId=&locationId=&assetGroupId=&assetId=`.
 * Four optional scope ids, each a lower-cased uuid (`scopeIdQueryField`).
 * `locationId` covers the node's subtree, by the alarm list's walk. Each only
 * narrows (`AssetFilterScopeService.narrow`): an id outside the caller's scope
 * answers an empty list, not 403. `.strict()`, as the alarm list is: an
 * unknown key is a 400 rather than an unfiltered list the caller would read
 * as filtered (no caller sent a query here before this).
 */
export const ruleListQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
    assetGroupId: scopeIdQueryField,
    assetId: scopeIdQueryField,
  })
  .strict();

export type RuleListQuery = z.infer<typeof ruleListQuerySchema>;
