import type {
  AlarmSkillCode,
  AutomationRuleCategory,
  AutomationRuleOperator,
  AutomationRuleSeverity,
  CalcDialect,
  // F3.1a: the widget vocabulary and its four config variants, derived rather than restated —
  // §4.8's "a vocabulary is declared once and everything else is derived from it". Taken from
  // `./index` like every other type here: the alias lives there, and the cycle is harmless
  // because `index.ts` re-exports this file with `export type *`, so both sides erase.
  DashboardWidgetSpec,
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  WorkOrderPriority,
} from "./index";

/**
 * The `asset_templates.content` overlay (ADR 0019, backlog `E1.7`).
 *
 * These are the DTO types; the Zod validator that produces them lives in
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`.
 * A compile-time assignability assertion in that file keeps the two from
 * drifting apart.
 *
 * That split was originally justified by `@bms/shared` being **types-only**, so
 * that a Zod schema here would have added a runtime dependency (AGENTS.md
 * §9.4). **That reason expired with ADR 0030**, which gave this package a
 * runtime and `src/contracts/`. The split stands on its own merits now — the
 * validator is an API-side concern and ADR 0019 §8 ratifies where it lives —
 * but it is no longer load-bearing, and a future move would not be blocked by
 * §9.4.
 *
 * Two sections are deliberately absent: `health` (`E1.1`) and `optimisation`
 * (`E1.6`) are *rejected* by the validator rather than accepted untyped, so
 * `E5.1` cannot author a shape those items will contradict.
 *
 * Split out of `index.ts` rather than added to it because that file was at the
 * §4.5 1000-line cap.
 */

export type TemplateAlarmPhilosophy = {
  cause?: string;
  impact?: string;
  action?: string;
  /**
   * ADR 0034 (`E2.1`): a code into `bms.alarm_skills`, not free text. Was
   * `string` — no seed content populated it, so tightening carries no
   * migration.
   */
  skill?: AlarmSkillCode;
};

/**
 * A threshold plus the class-level knowledge about it.
 *
 * Bound to the live rule vocabulary — `AutomationRuleOperator` has no `neq` and
 * severity is three values — so a template cannot author an alarm the engine
 * cannot run. `philosophy` is `E2.1`'s vocabulary and `E2.1` is not built; it
 * may still be renamed or restructured.
 *
 * Nothing converts one of these into a `bms.automation_rules` row. That needs
 * `ruleType`/`condition`/`action`, which a template does not carry.
 */
export type TemplateAlarm = {
  code: string;
  pointKey: string;
  operator: AutomationRuleOperator;
  thresholdValue: number;
  severity: AutomationRuleSeverity;
  message: string;
  /**
   * ADR 0019 §3 binds this to the rule vocabulary rather than restating it.
   *
   * This used to be `AuthorableRuleCategory`, a deliberately narrower type,
   * because the returned union was wider by `electrical` — what migration 0022
   * wrote directly (F4.43). ADR 0031 removed that gap at the cause: `electrical`
   * is a plant domain and now lives only on the asset, and
   * `automation_rules_category_fk` stops the column holding a code that is not a
   * row in `bms.rule_categories`.
   * So there is one vocabulary, and a template still cannot author a category
   * the API would refuse.
   */
  category?: AutomationRuleCategory;
  philosophy?: TemplateAlarmPhilosophy;
};

/**
 * `expression` is opaque behind `dialect: "unvalidated"` — content written
 * before ADR 0036 (`F2.3`) and never re-saved. `dialect: "bms-calc-v1"` means
 * `expression` has been parsed under the `bms-calc-v1` grammar
 * (`packages/shared/src/calc-dsl`) and `pointKeys` is exactly the set of
 * point references it uses, not merely a bookkeeping array checked without a
 * parser.
 */
export type TemplateKpi = {
  code: string;
  name: string;
  unit?: string;
  pointKeys: string[];
  expression: string;
  dialect: "unvalidated" | CalcDialect;
  higherIsBetter?: boolean;
};

/**
 * A maintenance plan at asset-class level — the create-schedule body minus the
 * two fields only an instance can know (`assetId`, `firstDueAt`).
 *
 * Nothing materialises these into `bms.maintenance_task_templates`; that table's
 * `asset_id` is `NOT NULL`, so a plan becomes a row only once an asset exists.
 * That is `E3.x` work with its own ADR.
 */
export type TemplateMaintenancePlan = {
  title: string;
  description?: string;
  category: MaintenanceScheduleCategory;
  generationMode: MaintenanceGenerationMode;
  ownerTeam?: string;
  vendorName?: string;
  complianceRef?: string;
  triggerSummary?: string;
  safetyCritical: boolean;
  priority: WorkOrderPriority;
  estimatedMinutes: number;
  intervalDays: number;
};

/**
 * One widget on a template's default dashboard (`F3.1a`, ADR 0047).
 *
 * **The point reference is the asymmetry worth knowing.** A *live* dashboard binds
 * `bms.asset_points.id` as foreign-key rows in `bms.dashboard_widget_points`, because ADR 0047
 * decision 3 rejects ids inside JSON. A *template* dashboard has no asset yet, so it binds
 * `template_points.point_key` **strings**, exactly as `featured[]` already does, and existence
 * is proved by `collectContentPointRefs` → `assertContentRefsResolve` on create, update and
 * publish rather than by a constraint. Same widget vocabulary, same config union; only the
 * reference differs.
 *
 * The type and grid halves are derived from the shared union rather than restated, so a fifth
 * widget type or a changed config shape cannot reach one surface and miss the other.
 */
export type TemplateDashboardWidget = {
  pointKeys: string[];
  title?: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
} & DashboardWidgetSpec;

/**
 * Which points matter for this asset type, in what order — and, since `F3.1a`, how they are
 * drawn.
 *
 * `featured` is the ADR 0019 ordering and stays: it is what a consumer with no widget support
 * reads, and every stored row written before ADR 0047 has only this key. `widgets` is optional
 * for the same reason — nothing backfills those rows, and `POST :id/draft` byte-copies stored
 * content, so a required `widgets` would strand a pre-`F3.1a` template behind its own immutable
 * published version.
 *
 * This docblock used to end "No widget types, no layout, no sizes — that is `F3.1`'s
 * vocabulary." ADR 0047 is that vocabulary, so the sentence is now false and is replaced rather
 * than left to mislead. ADR 0047 §Consequences rules this edit lands with the code: it is not
 * `AGENTS.md`, so it is not §9.10-gated.
 */
export type TemplateDashboardView = {
  featured: string[];
  widgets?: TemplateDashboardWidget[];
};

export type TemplateContent = {
  /**
   * Absent on a row written before `E1.7` **means 1**; no migration backfills
   * it, so consumers must not require the field.
   */
  contentVersion: 1;
  kpis?: TemplateKpi[];
  alarms?: TemplateAlarm[];
  maintenance?: TemplateMaintenancePlan[];
  dashboards?: Record<string, TemplateDashboardView>;
};
