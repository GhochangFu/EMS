/**
 * Operational contracts — energy, alarms, rules, work orders, maintenance.
 *
 * `automationRuleConditionSchema` is a `z.union` rather than a
 * `z.discriminatedUnion`: its two arms share no key, so there is no
 * discriminant to switch on. `alarmSocketEventSchema` does have one and uses
 * the discriminated form, which gives better parse errors.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

/** Energy Centre KPI row (`GET /api/v1/dashboard/energy/summary`). */
export const energyCentreSummarySchema = z.object({
  window: z.string(),
  totalKwh: z.number(),
  peakKw: z.number(),
  pueEstimate: z.number(),
  indicativeCostZar: z.number(),
  tariffZarPerKwh: z.number(),
  asOf: z.string(),
});

/** Stacked source mix (grid / solar / nominal DG slice) per time bucket. */
export const energySourceMixPointSchema = z.object({
  t: z.string(),
  gridKw: z.number(),
  solarKw: z.number(),
  dgKw: z.number(),
});

/** Top consumers by average kW in the window. */
export const energyTopConsumerSchema = z.object({
  assetId: z.string(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  avgKw: z.number(),
  estimatedKwh: z.number(),
});

export const energyReportTemplateSchema = z.object({
  id: z.literal("energy_consumption"),
  title: z.string(),
  description: z.string(),
  formats: z.array(z.string()),
  active: z.boolean(),
});

export const energyReportSourceTotalsSchema = z.object({
  gridKwh: z.number(),
  solarKwh: z.number(),
  dgKwh: z.number(),
});

/** Preview payload for Phase 5 Sprint E Energy Consumption reports. */
export const energyReportPreviewSchema = z.object({
  template: energyReportTemplateSchema,
  range: z.object({
    startDate: z.string(),
    endDate: z.string(),
    durationHours: z.number(),
  }),
  generatedAt: z.string(),
  summary: energyCentreSummarySchema,
  sourceTotals: energyReportSourceTotalsSchema,
  topConsumers: z.array(energyTopConsumerSchema),
  notes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

/** One alarm row for list / WebSocket payloads (`GET /api/v1/alarms`). */
export const alarmListItemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  ruleKey: z.string().nullable(),
  // F3.6 / ADR 0033 (migration 0032). Nullable for the same reason `rule_id`
  // is nullable in `bms.alarms`: a historical alarm raised before this column
  // existed, or by the pre-merge hardcoded ladder, cannot always be
  // attributed to a rule.
  ruleId: z.string().nullable(),
  severity: z.string(),
  message: z.string(),
  raisedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  assetCode: z.string(),
  assetName: z.string(),
  siteName: z.string(),
});

/** Socket.IO `/ws/alarms` event payload. */
export const alarmSocketEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created"), alarm: alarmListItemSchema }),
  z.object({ type: z.literal("acknowledged"), alarm: alarmListItemSchema }),
]);

// ---------------------------------------------------------------------------
// Work orders and maintenance
// ---------------------------------------------------------------------------

export const workOrderStatusSchema = z.enum([
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
]);

export const workOrderPrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const maintenanceDueStateSchema = z.enum(["overdue", "upcoming"]);

export const maintenanceScheduleCategorySchema = z.enum([
  "preventive",
  "predictive",
  "condition_based",
  "compliance",
  "amc",
  "calibration",
  "runtime_based",
  "seasonal",
  "inspection_round",
  "corrective_follow_up",
  "deferred_backlog",
  "shutdown_outage",
  "energy_optimization",
  "safety_critical",
]);

export const maintenanceGenerationModeSchema = z.enum([
  "manual",
  "calendar",
  "runtime",
  "condition",
  "predictive",
]);

/** One work order row for Phase 5 Sprint A API responses. */
export const workOrderListItemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  alarmId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: workOrderStatusSchema,
  priority: workOrderPrioritySchema,
  sortOrder: z.number(),
  assignedTo: z.string().nullable(),
  createdBy: z.string().nullable(),
  dueAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  siteName: z.string(),
});

/** Maintenance schedule item shown in the Phase 5 Sprint C Schedule Centre. */
export const maintenanceScheduleItemSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  assetId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: maintenanceScheduleCategorySchema,
  generationMode: maintenanceGenerationModeSchema,
  ownerTeam: z.string().nullable(),
  vendorName: z.string().nullable(),
  complianceRef: z.string().nullable(),
  triggerSummary: z.string().nullable(),
  safetyCritical: z.boolean(),
  priority: workOrderPrioritySchema,
  estimatedMinutes: z.number(),
  intervalDays: z.number(),
  nextDueAt: z.string(),
  lastCompletedAt: z.string().nullable(),
  dueState: maintenanceDueStateSchema,
  assetCode: z.string(),
  assetName: z.string(),
  siteName: z.string(),
  activeWorkOrderId: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

export const automationRuleTypeSchema = z.enum(["threshold", "time_window"]);

/**
 * Both of a rule's axes are **open vocabularies stored as data** (ADR 0031 +
 * Amendment 1), so neither is a `z.enum` here.
 *
 * ## Why these are not enums
 *
 * `automation_rules.category` used to hold two different kinds of thing at
 * once. `comfort`/`energy`/`safety`/`operations` are **concerns** — what a rule
 * is about. `electrical` is a **plant domain** — what equipment it watches,
 * which no operator ever chose: migration `0022` wrote it directly on the PHE
 * pilot's 48 rules. Every defect in this area was a symptom of that overload:
 *
 * - `F4.23`'s response validator reported it, after 48 of 89 rules had rendered
 *   with an **empty, unstyled** badge for as long as `0022` had been deployed,
 *   because `categoryStyle`'s exhaustive `switch` returned `undefined` for a
 *   value TypeScript said could not occur.
 * - `F4.43` widened the *read* union only, leaving a documented asymmetry.
 * - `F4.44` found the authoring surface still wrong underneath it: a `<select>`
 *   whose value matches no `<option>` renders its **first** option, so editing a
 *   PHE rule silently claimed `Operations`.
 *
 * `F4.45` fixed the cause: the axes are separate, and each has a table.
 * `automation_rules_category_fk` and `assets_domain_fk` (migration `0029`) are
 * the enforcement — **stronger than the enum they replaced**, because a foreign
 * key cannot be out of step with the values that exist.
 *
 * The domain vocabulary is open because the roadmap says so: `E5.1`
 * water-treatment, `E5.2` mechanical/utility and `E5.3` facility/smart-building
 * are three scheduled domain packs, each of which would otherwise have needed a
 * migration to declare itself.
 *
 * ## What this costs, stated plainly
 *
 * A `z.string()` here means the response validator can no longer report an
 * unknown category the way it reported `electrical`. That check moved to the
 * database, where it is absolute rather than advisory — but it is no longer
 * *this file's* check, and the next reader should know that rather than assume
 * this contract still describes the value set. `GET /api/v1/vocabularies` is
 * where the live set comes from.
 */
export const ruleCategoryCodeSchema = z.string().min(1).max(64);
export const assetDomainCodeSchema = z.string().min(1).max(64);
/**
 * A severity code (ADR 0032). Shape only, for the same reason as the two above:
 * the set now lives in `bms.alarm_severities` and is closed by
 * `alarms_severity_fk` / `automation_rules_severity_fk`, not by this file.
 *
 * **This used to be a `z.enum`**, and the change is worth knowing about: a
 * string outside the live set no longer fails *here*. It fails at
 * `VocabulariesService.assertAlarmSeverity` with a 400, or at the foreign key.
 * `GET /api/v1/vocabularies` is where the live set comes from.
 */
export const alarmSeverityCodeSchema = z.string().min(1).max(64);

/**
 * A skill/trade code (ADR 0034, `E2.1`). Shape only, for the same reason as
 * the three above: the set lives in `bms.alarm_skills` and is closed by
 * `alarm_enrichments_skill_code_fkey`, not by this file.
 * `GET /api/v1/vocabularies` is where the live set comes from.
 */
export const alarmSkillCodeSchema = z.string().min(1).max(64);

/**
 * The concern a rule gets when nobody picks one.
 *
 * Declared once and imported by both sides deliberately. The API's
 * `ruleDraftBodySchema` defaults to it, and the rule builder starts a new draft
 * on it — and those two silently disagreeing is a real defect, not a tidiness
 * point: the builder briefly defaulted to whichever concern sorted first, which
 * made a form show `Safety` while an unsent field would have stored
 * `operations`. That is the `F4.44` divergence — control and state disagreeing
 * about the same field — arriving by a different route.
 *
 * It is a code, not a member of a union, so it is only *meaningful* while a row
 * with this code exists. `bms.rule_categories` seeds it in migration `0029`,
 * and `active = false` on that row would make the builder offer a list this
 * value is not in — which is why `defaultCategoryCode` falls back to the first
 * offered entry rather than trusting this blindly.
 */
export const DEFAULT_RULE_CATEGORY_CODE = "operations";

/**
 * How a category badge is styled. **This** vocabulary is genuinely closed — it
 * is presentation, owned by the frontend, and it keeps a SQL `CHECK`
 * (`rule_categories_tone_check`).
 *
 * It exists because `categoryStyle` was an exhaustive `switch` over the old
 * enum: with the category vocabulary open, a newly seeded category would have
 * rendered unstyled, which is exactly the `F4.43` empty-badge failure. Styling
 * has to travel with the value.
 */
export const badgeToneSchema = z.enum([
  "critical",
  "warning",
  "positive",
  "informational",
  "neutral",
]);

/** One row of `bms.rule_categories`. */
export const ruleCategoryDtoSchema = z.object({
  code: ruleCategoryCodeSchema,
  label: z.string(),
  tone: badgeToneSchema,
  sortOrder: z.number(),
  active: z.boolean(),
});

/** One row of `bms.asset_domains`. */
export const assetDomainDtoSchema = z.object({
  code: assetDomainCodeSchema,
  label: z.string(),
  sortOrder: z.number(),
  active: z.boolean(),
});

/**
 * How a severity pill and summary card are styled (ADR 0032).
 *
 * Closed for the same reason `badgeToneSchema` is closed and for no other: it
 * is presentation, owned by the frontend, and it keeps a SQL `CHECK`
 * (`alarm_severities_tone_check`). These five are the `StatusPill` palette
 * (`status-pill.tsx:3`) exactly — a sixth value here renders nothing.
 *
 * It is a *different* list from `badgeToneSchema` on purpose. That one styles a
 * category badge and has `positive` / `informational` / `neutral`; this one
 * styles an alarm and has `offline` / `ok`. Merging them would force one
 * component's palette onto the other.
 */
export const pillToneSchema = z.enum(["critical", "warning", "info", "offline", "ok"]);

/** One row of `bms.alarm_severities`. */
export const alarmSeverityDtoSchema = z.object({
  code: alarmSeverityCodeSchema,
  label: z.string(),
  tone: pillToneSchema,
  /**
   * Urgency. Higher is more urgent, and the seeded values are spaced by ten so
   * a level can be added between two existing ones without renumbering live
   * rows — see ADR 0032 decision 2. This is the column that lets an open
   * vocabulary carry a column that has behaviour attached.
   */
  rank: z.number(),
  active: z.boolean(),
});

/** One row of `bms.alarm_skills` (ADR 0034). No `tone`, no `rank` — a skill
 * drives no styling and carries no urgency; matches `assetDomainDtoSchema`'s
 * shape, not `alarmSeverityDtoSchema`'s. */
export const alarmSkillDtoSchema = z.object({
  code: alarmSkillCodeSchema,
  label: z.string(),
  sortOrder: z.number(),
  active: z.boolean(),
});

/**
 * An asset role code (ADR 0049 decision 5, `F3.37`). Shape only, for the same
 * reason as the four above: the set lives in `bms.asset_roles` and is closed by
 * `asset_group_members_role_fkey`, not by this file.
 *
 * **Never make this a `z.enum`.** §4.8's test as ADR 0032 rewrote it asks
 * whether the behaviour can be carried as data. A widget type's behaviour is a
 * React component and a metric's is a SQL query, so ADR 0047 decision 2 and ADR
 * 0048 decision 1 both closed theirs. A role's behaviour is "match this
 * member", which *is* the code — a role declared by an `INSERT` arrives fully
 * functional. `tests/f3.37-asset-role-vocabulary.test.ts` holds this line
 * against the reader who finds the fetch inconvenient and pastes the 26 codes
 * back in. `GET /api/v1/vocabularies` is where the live set comes from.
 */
export const assetRoleCodeSchema = z.string().min(1).max(64);

/** One row of `bms.asset_roles` (ADR 0049). No `tone`, no `rank` — a role
 * drives no styling and carries no urgency; matches `assetDomainDtoSchema`'s
 * shape, not `alarmSeverityDtoSchema`'s. */
export const assetRoleDtoSchema = z.object({
  code: assetRoleCodeSchema,
  label: z.string(),
  sortOrder: z.number(),
  active: z.boolean(),
});

/**
 * `GET /api/v1/vocabularies` — all five open vocabularies in one response.
 *
 * One endpoint rather than four because every consumer needs them together:
 * the rules page renders a concern badge beside a plant badge and a severity
 * control, and a single query means a single cache key and no half-loaded
 * render. It was two axes until ADR 0032 added `alarmSeverities`, three until
 * ADR 0034 added `alarmSkills`, and four until ADR 0049 added `assetRoles`; the
 * argument for one endpoint got stronger rather than weaker each time, since a
 * page cannot classify a single row until the relevant list has arrived.
 *
 * **Added as a plain key, never `.extend()` or `.merge()`.**
 * `tests/adr-0030-contract-derivation.test.ts` scans this directory for both
 * and fails the build, because a flattened intersection still typechecks
 * everywhere it is used and so nothing else would report it.
 */
export const vocabulariesResponseSchema = z.object({
  ruleCategories: z.array(ruleCategoryDtoSchema),
  assetDomains: z.array(assetDomainDtoSchema),
  /** ADR 0032. Ordered by `rank` ascending, so the array reads least- to most-urgent. */
  alarmSeverities: z.array(alarmSeverityDtoSchema),
  /** ADR 0034. Ordered by `sortOrder` ascending. */
  alarmSkills: z.array(alarmSkillDtoSchema),
  /** ADR 0049 decision 5 (`F3.37`). Ordered by `sortOrder` ascending. */
  assetRoles: z.array(assetRoleDtoSchema),
});
export const automationRuleOperatorSchema = z.enum(["gt", "gte", "lt", "lte", "eq"]);
/**
 * ADR 0032: a code, not a union. Was `z.enum(["info","warning","critical"])`.
 * The set is closed by `bms.alarm_severities` and the two foreign keys; this
 * checks shape only. See `alarmSeverityCodeSchema` for what moved and why.
 */
export const automationRuleSeveritySchema = alarmSeverityCodeSchema;

/** One row of `bms.alarm_affected_assets`, joined for display (ADR 0034). */
export const alarmAffectedAssetDtoSchema = z.object({
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
});

/**
 * `bms.alarm_enrichments`, one row per alarm (ADR 0034, `E2.1`). Every field
 * but the timestamps is nullable/optional — an alarm may have no enrichment
 * written yet, and each field is filled independently by an operator.
 */
export const alarmEnrichmentDtoSchema = z.object({
  rootCause: z.string().nullable(),
  impact: z.string().nullable(),
  correctiveActions: z.string().nullable(),
  energyImpact: z.string().nullable(),
  waterImpact: z.string().nullable(),
  productionImpact: z.string().nullable(),
  etrAt: z.string().nullable(),
  skillCode: alarmSkillCodeSchema.nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  affectedAssets: z.array(alarmAffectedAssetDtoSchema),
});

/**
 * `GET /api/v1/alarms/:id/details` (ADR 0034 decision 5). Computed at read
 * time — nothing here is stored beyond the alarm/asset/rule rows and the
 * enrichment itself. `thresholdOperator`/`thresholdValue`/`currentValue` are
 * all `null` together when the alarm has no linked rule (`ruleId IS NULL`) —
 * a historical alarm, or one raised outside the rule engine (ADR 0033
 * decision 5) — rather than the request failing.
 */
export const alarmDetailsResponseSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  /** The alarm's own asset's organization — found needed in review: the
   * affected-asset picker (ADR 0034 decision 4) must narrow its candidate
   * list to this organization, or it mixes assets across tenants. */
  organizationId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  assetDomain: z.string(),
  locationName: z.string(),
  siteName: z.string(),
  severity: z.string(),
  message: z.string(),
  raisedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  ruleId: z.string().nullable(),
  thresholdOperator: automationRuleOperatorSchema.nullable(),
  thresholdValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  currentValueUnit: z.string().nullable(),
  currentValueAt: z.string().nullable(),
  enrichment: alarmEnrichmentDtoSchema.nullable(),
});

// `alarmEnrichmentUpsertBodySchema` (the `PUT .../enrichment` request body)
// deliberately does NOT live here — AGENTS.md §3 / ADR 0030 decision 3:
// request schemas stay in `apps/api` (`apps/api/src/alarms/enrichment.schema.ts`),
// only response contracts live in this package. Found by compliance review
// on ADR 0034: the first draft declared it here by mistake.

export const automationRuleLifecycleStatusSchema = z.enum(["draft", "published", "archived"]);
export const ruleExecutionStatusSchema = z.enum([
  "matched",
  "not_matched",
  "skipped",
  "error",
]);

/** No shared key across the arms, so `z.union` rather than the discriminated form. */
export const automationRuleConditionSchema = z.union([
  z.object({ window: z.literal("latest"), unit: z.string().optional() }),
  z.object({ days: z.array(z.string()), startTime: z.string(), endTime: z.string() }),
]);

export const automationRuleActionSchema = z.object({
  type: z.enum(["notify", "review", "trace_only"]),
  target: z.string(),
});

/** Basic automation rule row for Phase 5 Sprint D Rule Engine responses. */
export const ruleListItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: ruleCategoryCodeSchema,
  ruleType: automationRuleTypeSchema,
  /**
   * Who created the rule. `phe_alarm_seed` is migration 0022's marker for the
   * PHE pilot's 48 rules — same omission as `category` above, found the same
   * way, and the migration uses it as its own idempotency key
   * (`WHERE r.source = 'phe_alarm_seed'`), so it is load-bearing rather than
   * decorative.
   *
   * `simulator_threshold` is migration 0033's marker (F3.6 / ADR 0033) for the
   * ESKOM demo's five threshold rules, seeded to replace the hardcoded ladder
   * `AlarmThresholdService` used to evaluate in code — same idempotency-key
   * role `phe_alarm_seed` plays above, via `NOT EXISTS` on the condition
   * tuple rather than a `WHERE r.source = ...` literal.
   */
  source: z.enum(["operator_rule", "simulator_threshold", "phe_alarm_seed"]),
  enabled: z.boolean(),
  assetId: z.string().nullable(),
  assetCode: z.string().nullable(),
  assetName: z.string().nullable(),
  siteName: z.string().nullable(),
  /**
   * The rule's **plant domain**, read from the asset (ADR 0031) — the second
   * axis, never stored on the rule.
   *
   * `nullable` for the same reason `assetCode` and `siteName` are: the rules
   * query LEFT JOINs `assets`, and a rule need not target one. The column
   * itself is `NOT NULL`, so a null here means "no asset", never "no domain".
   */
  assetDomain: assetDomainCodeSchema.nullable(),
  pointKey: z.string().nullable(),
  operator: automationRuleOperatorSchema.nullable(),
  thresholdValue: z.number().nullable(),
  severity: z.string().nullable(),
  lifecycleStatus: automationRuleLifecycleStatusSchema,
  condition: automationRuleConditionSchema,
  action: automationRuleActionSchema,
  lastEvaluatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  duplicatedFromRuleId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ruleBuilderCatalogAssetSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  /**
   * Sourced from `assets.domain` by the catalogue query in `rules.service.ts`,
   * which is the one thing that makes the enum safe here (ADR 0031). Other
   * `domain` fields in these contracts read from `rtus`, `point_keys` or
   * `asset_templates` and stay `z.string()`.
   */
  domain: assetDomainCodeSchema,
  pointKeys: z.array(z.string()),
});

export const rulePreviewResultSchema = z.object({
  status: ruleExecutionStatusSchema,
  matched: z.boolean(),
  observedValue: z.number().nullable(),
  message: z.string(),
  trace: z.record(z.unknown()),
});

/** One evaluation trace row for the Phase 5 Sprint D Rule Engine. */
export const ruleExecutionItemSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleCode: z.string(),
  ruleName: z.string(),
  evaluatedAt: z.string(),
  status: ruleExecutionStatusSchema,
  matched: z.boolean(),
  observedValue: z.number().nullable(),
  message: z.string().nullable(),
  trace: z.record(z.unknown()).nullable(),
});
