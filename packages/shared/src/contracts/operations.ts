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
 * What a rule's `category` can be **on the way out**.
 *
 * **This is deliberately wider than what the API accepts on the way in**, and
 * the asymmetry is the whole point of `F4.43` — do not "tidy" it by making the
 * two match without reading this.
 *
 * `apps/api/src/rules/rules.schema.ts`'s `categorySchema` is the *write*
 * vocabulary: four values, and ADR 0019 §3 binds template `content.alarms` to
 * it as well. No operator can author an `electrical` rule and none should be
 * able to.
 *
 * `electrical` exists because
 * `packages/db/drizzle/0022_phe_alarm_threshold_rules.sql` writes it directly
 * for the PHE pilot's **48 threshold rules** — bypassing the API, which a
 * migration is entitled to do. It was absent here until `F4.23`'s response
 * validator reported it, at which point 48 of 89 rules had been rendering with
 * an **empty, unstyled** category badge and no way to filter to them, because
 * `categoryStyle`'s exhaustive `switch` returned `undefined` for a value
 * TypeScript said could not occur.
 *
 * A read union that omits what the database contains is not a stricter
 * contract; it is a false one.
 *
 * **`safety` is authorable and simply unpopulated** (0 rows) — the rule builder
 * offers it. It is not dead.
 *
 * **Residual risk, accepted knowingly:** neither `category` nor `source` has a
 * `CHECK` constraint, so a future writer can still introduce a value nobody
 * declared. Constraining them is DDL and was scoped out of `F4.43` as its own
 * ADR. Until then, the response validator is what would notice — which is how
 * this one was found.
 */
export const authorableRuleCategorySchema = z.enum([
  "comfort",
  "energy",
  "safety",
  "operations",
]);

/**
 * **Derived from the authorable set, not restated beside it.** The read union
 * is the write union plus what migrations write directly, so read ⊇ write holds
 * *by construction* rather than by a test that has to be remembered.
 *
 * A test asserting the containment would have been tautological the moment this
 * was written this way — AGENTS.md §4.4's list of guards that pass while
 * checking nothing. Making it impossible beats checking it did not happen.
 */
export const automationRuleCategorySchema = z.enum([
  ...authorableRuleCategorySchema.options,
  "electrical",
]);
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
  category: automationRuleCategorySchema,
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
  domain: z.string(),
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
