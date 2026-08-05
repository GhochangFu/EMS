import type {
  AutomationRuleCategory,
  AutomationRuleOperator,
  AutomationRuleSeverity,
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  WorkOrderPriority,
} from "./index";

/**
 * The `asset_templates.content` overlay (ADR 0019, backlog `E1.7`).
 *
 * These are the DTO types; the Zod validator that produces them lives in
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`,
 * because `@bms/shared` is types-only and a Zod schema here would be a runtime
 * dependency (AGENTS.md §9.4). A compile-time assignability assertion in that
 * file keeps the two from drifting apart.
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
  skill?: string;
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
  category?: AutomationRuleCategory;
  philosophy?: TemplateAlarmPhilosophy;
};

/**
 * `expression` is opaque: `F2.3` owns formula syntax and has not frozen it, so
 * `dialect` stays `"unvalidated"` until it does. `pointKeys` is listed
 * separately from the expression precisely so references can be checked without
 * a parser.
 */
export type TemplateKpi = {
  code: string;
  name: string;
  unit?: string;
  pointKeys: string[];
  expression: string;
  dialect: "unvalidated";
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
 * Which points matter for this asset type, in what order. No widget types, no
 * layout, no sizes — that is `F3.1`'s vocabulary.
 */
export type TemplateDashboardView = {
  featured: string[];
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
