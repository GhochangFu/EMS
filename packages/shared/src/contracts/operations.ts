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
 * `GET /api/v1/vocabularies` — both axes in one response.
 *
 * One endpoint rather than two because every consumer needs both together: the
 * rules page renders a concern badge beside a plant badge, and a single query
 * means a single cache key and no half-loaded render.
 */
export const vocabulariesResponseSchema = z.object({
  ruleCategories: z.array(ruleCategoryDtoSchema),
  assetDomains: z.array(assetDomainDtoSchema),
});
export const automationRuleOperatorSchema = z.enum(["gt", "gte", "lt", "lte", "eq"]);
export const automationRuleSeveritySchema = z.enum(["info", "warning", "critical"]);
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
   * `simulator_threshold` is declared and written by nothing. Left in place
   * deliberately: removing a value from a *response* union narrows a contract,
   * and that is a separate change from widening one.
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
