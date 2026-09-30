import {
  METRIC_CATALOG,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
  WIDGET_SOURCE_SHAPES,
  dashboardWidgetSpecSchema,
  isTemplateAuthorableWidgetType,
  metricCatalogKeySchema,
  widgetTypeBindsNothing,
  widgetTypeSchema,
} from "./dashboard-builder";
import {
  SITE_WIDGET_TYPES,
  activeAlarmsRailConfigSchema,
  moduleSummaryCardConfigSchema,
  siteWidgetsResponseSchema,
} from "./site-widgets";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DASHBOARD_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";

/** The five types are exactly the ones the contract names, in the enum, each with an arm. */
export function fiveSiteWidgetTypesAreInTheEnumWithAnArm(): void {
  assert(
    JSON.stringify(SITE_WIDGET_TYPES) ===
      JSON.stringify([
        "active_alarms_rail",
        "state_legend",
        "asset_class_strip",
        "module_summary_card",
        "critical_systems_list",
      ]),
    `the site widget types are the plan's five, got ${JSON.stringify(SITE_WIDGET_TYPES)}`,
  );
  const configs: Record<string, unknown> = {
    active_alarms_rail: {},
    state_legend: {},
    asset_class_strip: {},
    module_summary_card: { targetTabKey: "hvac" },
    critical_systems_list: {},
  };
  for (const type of SITE_WIDGET_TYPES) {
    assert(widgetTypeSchema.options.includes(type), `${type} is missing from widgetTypeSchema`);
    const parsed = dashboardWidgetSpecSchema.safeParse({ widgetType: type, config: configs[type] });
    assert(parsed.success, `${type} must have a spec arm and parse a valid config`);
  }
}

/** Each of the five binds nothing and is refused by a template: it reads the site, not a point. */
export function siteWidgetsBindNothingAndAreNotTemplateAuthorable(): void {
  for (const type of SITE_WIDGET_TYPES) {
    assert(widgetTypeBindsNothing(type), `${type} must bind neither a point nor a source`);
    assert(
      WIDGET_POINT_CARDINALITY[type].min === 0 && WIDGET_POINT_CARDINALITY[type].max === 0,
      `${type} takes no point`,
    );
    assert(
      WIDGET_SOURCE_CARDINALITY[type].min === 0 && WIDGET_SOURCE_CARDINALITY[type].max === 0,
      `${type} takes no source`,
    );
    assert(WIDGET_SOURCE_SHAPES[type].length === 0, `${type} accepts no catalog shape`);
    assert(!isTemplateAuthorableWidgetType(type), `${type} must not be template-authorable`);
  }
}

/** The rail's two fields default, and its row count is bounded 1..20. */
export function railConfigDefaultsAndBounds(): void {
  const empty = activeAlarmsRailConfigSchema.parse({});
  assert(empty.rows === 8 && empty.showSummary === true, `rail defaults are 8 rows with summary, got ${JSON.stringify(empty)}`);
  assert(activeAlarmsRailConfigSchema.safeParse({ rows: 0 }).success === false, "0 rows must be refused");
  assert(activeAlarmsRailConfigSchema.safeParse({ rows: 21 }).success === false, "21 rows must be refused");
  assert(activeAlarmsRailConfigSchema.safeParse({ rows: 20 }).success === true, "20 rows must parse");
  assert(activeAlarmsRailConfigSchema.safeParse({ rows: 1.5 }).success === false, "a fractional row count must be refused");
}

/** The module card names a tab key, required, with the tab key's own rules. */
export function moduleCardRequiresAValidTabKey(): void {
  assert(moduleSummaryCardConfigSchema.safeParse({}).success === false, "targetTabKey is required");
  assert(moduleSummaryCardConfigSchema.safeParse({ targetTabKey: "assets" }).success === false, "the reserved key must be refused");
  assert(moduleSummaryCardConfigSchema.safeParse({ targetTabKey: "Bad Key" }).success === false, "a non-slug must be refused");
  assert(moduleSummaryCardConfigSchema.safeParse({ targetTabKey: "hvac" }).success === true, "hvac must parse");
}

/** The two catalog keys: a metric and a four-column dataset with NO role column. */
export function assetsCatalogEntriesAreDeclared(): void {
  assert(metricCatalogKeySchema.options.includes("assets.offline.count"), "assets.offline.count is a catalog key");
  assert(metricCatalogKeySchema.options.includes("assets.list"), "assets.list is a catalog key");
  const offline = METRIC_CATALOG["assets.offline.count"];
  assert(offline.shape === "metric" && !("params" in offline), "assets.offline.count is a param-less metric");
  const list = METRIC_CATALOG["assets.list"];
  assert(list.shape === "dataset", "assets.list is a dataset");
  if (list.shape === "dataset") {
    assert(
      JSON.stringify(list.columns) === JSON.stringify(["code", "name", "status", "activeAlarms"]),
      `assets.list declares code, name, status, activeAlarms, got ${JSON.stringify(list.columns)}`,
    );
    assert(!list.columns.includes("role"), "assets.list carries no role column (the Resolver has no group)");
  }
}

const tabStatus = {
  worstSeverity: "critical",
  tone: "critical",
  activeAlarms: 2,
  offlineAssets: 1,
  assets: 5,
};

function response(): Record<string, unknown> {
  return {
    dashboardId: DASHBOARD_ID,
    tabKey: "hvac",
    resolvedAt: "2026-09-30T10:00:00.000Z",
    scope: { assetCount: 5 },
    alarms: { active: [], summary: [] },
    roles: [],
    tabs: [{ tabKey: "hvac", label: "HVAC", assetGroupId: GROUP_ID, status: tabStatus }],
  };
}

/** The response parses, and a tab outside scope carries a null status. */
export function siteWidgetsResponseParses(): void {
  assert(siteWidgetsResponseSchema.safeParse(response()).success, "a well-formed response must parse");
  const outside = { ...response(), tabs: [{ tabKey: "hvac", label: "HVAC", assetGroupId: null, status: null }] };
  assert(siteWidgetsResponseSchema.safeParse(outside).success, "a tab outside scope has a null status");
  const overview = { ...response(), tabKey: null };
  assert(siteWidgetsResponseSchema.safeParse(overview).success, "the Overview / legacy read has a null tabKey");
}

/** The response is bounded: 20 alarms at most, and a non-uuid dashboard id is refused. */
export function siteWidgetsResponseIsBounded(): void {
  const alarm = {
    id: "a", assetId: "b", ruleKey: null, ruleId: null, severity: "critical", message: "m",
    raisedAt: "2026-09-30T10:00:00.000Z", acknowledgedAt: null, acknowledgedBy: null, clearedAt: null,
    assetCode: "X", assetName: "X", siteName: "S",
  };
  const twenty = { ...response(), alarms: { active: Array.from({ length: 20 }, () => alarm), summary: [] } };
  const twentyOne = { ...response(), alarms: { active: Array.from({ length: 21 }, () => alarm), summary: [] } };
  assert(siteWidgetsResponseSchema.safeParse(twenty).success === true, "20 alarms must parse");
  assert(siteWidgetsResponseSchema.safeParse(twentyOne).success === false, "21 alarms must be refused");
  assert(siteWidgetsResponseSchema.safeParse({ ...response(), dashboardId: "x" }).success === false, "a non-uuid id is refused");
}
