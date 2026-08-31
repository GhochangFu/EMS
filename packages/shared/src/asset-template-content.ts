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
 * One section is deliberately absent: `optimisation` (`E1.6`) is *rejected* by
 * the validator rather than accepted untyped, so `E5.1` cannot author a shape
 * that item will contradict.
 *
 * **`health` was the second of those until `E1.3`.** `E1.7` rejected the tier
 * rather than accepting it untyped, under the rule "each reopens as its
 * consumer lands", and `health` is now the fourth of five to reopen after
 * `kpis` (`F2.3`, ADR 0036), `alarms.philosophy` (`E2.1`, ADR 0034) and
 * `dashboards` (`F3.1a`, ADR 0047). ADR 0050 decision 7 is that reopening.
 * Only `optimisation` stays rejected.
 *
 * The old wording named `E1.1` as the blocking item. That edge was retired on
 * 2026-08-22 by the client's own answer — `E1.3` no longer depends on the ML
 * foundation, and the five-input SOW §4.3 score that does now has its own row
 * (`E1.8`).
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
 * publish rather than by a constraint. Same config union, and — until `F3.35` Stage B — the
 * same widget vocabulary; see the `table` paragraph below for the one type that is now
 * excluded, and why the reference difference is exactly what excludes it.
 *
 * The type and grid halves are derived from the shared union rather than restated, so a changed
 * config shape cannot reach one surface and miss the other. **That sentence used to say the
 * same of a fifth widget type, and `F3.35` Stage B made it false**: `table` reaches the live
 * builder and deliberately does not reach here. The MECHANISM the sentence prescribes survives —
 * the `Exclude` below still derives from the shared union rather than restating a list — but a
 * type can now be excluded on purpose, so the derivation proves agreement about config shape
 * rather than about membership.
 *
 * **`table` is excluded, and the exclusion is the point rather than an oversight** (`F3.35`
 * Stage B). Read the asymmetry above once more: a template binds point-key *strings* because it
 * has no asset yet. It has no equivalent for a **catalog source** — `bms.dashboard_widget_sources`
 * is keyed by `widget_id`, and a template widget is not a widget row. A `table` binds no point
 * (`WIDGET_POINT_CARDINALITY.table` is `{min: 0, max: 0}`) and requires exactly one source
 * (`WIDGET_SOURCE_CARDINALITY.table` is `{min: 1, max: 1}`), so a template `table` could carry
 * no binding of either kind. `F3.2` would then instantiate a widget that the live write path
 * refuses on its next save, and that an author sees as a permanently empty card.
 *
 * So the rule is not "every widget type is template-authorable" — it is **"a widget type is
 * template-authorable when it can be fully bound by point keys"**. `Exclude` states that here
 * at compile time; `asset-templates-content.schema.spec.ts` derives the same list from
 * `WIDGET_SOURCE_CARDINALITY` at run time, so a sixth type with a required source is caught
 * even though a `Record<WidgetType, {min: number}>` cannot be read at the type level.
 *
 * **This is reversible and is not a scope ruling.** Whenever templates gain a way to carry a
 * catalog binding, delete the `Exclude` and the spec's derivation agrees again.
 */
export type TemplateDashboardWidget = {
  pointKeys: string[];
  title?: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
} & Exclude<DashboardWidgetSpec, { widgetType: "table" }>;

/**
 * The widget types a template can author, derived from the exclusion above rather than listed.
 *
 * Named so the three surfaces that need it — the shared type, `apps/web`'s row type, and the
 * builder's type picker — say the same thing once. Writing `Exclude<WidgetType, "table">` at
 * each site would be three declarations of one rule, which is what §4.8 exists to prevent.
 */
export type TemplateAuthorableWidgetType = TemplateDashboardWidget["widgetType"];

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

/**
 * One band of the health score, as an ordered cut-point rather than an enum.
 *
 * The client's five names are Excellent / Good / Fair / Poor / Critical, and
 * they are stored as *data* per ADR 0050 decision 7 and the `prefer-dynamic
 * -vocabularies` rule that ADR 0031/0032 set: a band set is a lookup, never an
 * enum with a `CHECK`. A pack that wants three bands, or different names, needs
 * no migration.
 *
 * `minScore` is the **inclusive lower bound** and is in `0..1`, not `0..100` —
 * ADR 0050 Amendment 1 decision 2 puts the score itself on that scale, and a
 * band in the other unit is how a cut-point of `0.9` ends up compared against a
 * score of `90`. The conversion belongs at the rendering edge, with the `%`.
 */
export type TemplateHealthBand = {
  code: string;
  label: string;
  minScore: number;
};

/**
 * The `health` section — weights and bands, and nothing that computes.
 *
 * ADR 0050 decision 1 keeps aggregation out of the formula, so this carries no
 * expression: the score is a ratio of counts the roll-up materialises, and what
 * an author configures is how the tags are weighted against each other and
 * where the bands fall.
 *
 * **`weights` is optional and `bands` is not** (Amendment 1 decision 3). An
 * omitted weight is `1.0`, because equal weighting is the only defensible
 * default and refusing to score without one would make the tier's adoption a
 * flag day. Five cut-points cannot be guessed the same way, and inventing them
 * puts a fabricated "Excellent" on an executive screen.
 *
 * A key of `weights` is a `template_points.point_key` on the same template, and
 * `collectContentPointRefs` reaches it — so a weight on a point the template
 * does not declare is caught on create, update and publish, exactly as a KPI's
 * `pointKeys` is.
 */
export type TemplateHealth = {
  weights?: Record<string, number>;
  bands: TemplateHealthBand[];
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
  /** ADR 0050 decision 7 (`E1.3`). Absent means the asset scores numerically
   * and reports `band: null` — it is counted, never dropped. */
  health?: TemplateHealth;
};
