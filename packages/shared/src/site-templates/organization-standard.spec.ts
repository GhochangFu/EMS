import { DASHBOARD_GRID } from "../contracts/dashboard-builder";
import { sourceBindingWriteSchema } from "../contracts/metric-catalog-params";
import {
  sectionTemplateContentSchema,
  stockDashboardTemplateDtoSchema,
  templateTargetContentMessage,
} from "../contracts/dashboard-templates";
import type { StockDashboardTemplateDto } from "../index";
import { ORGANIZATION_STANDARD_TEMPLATE } from "./organization-standard";

/**
 * `F4.317` task 3.3 — the stock organization strip, `organization-standard` (ADR 0112 decisions
 * 3 and 6, Amendment 1). Assertions live here; `organization-standard.test.ts` is the Vitest
 * entry point (ADR 0014). One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Widened to the contract type, so an optional config key reads as `undefined`.
const entry: StockDashboardTemplateDto = ORGANIZATION_STANDARD_TEMPLATE;

export function theEntryIsTheOrganizationTargetStockRow(): void {
  const shape = `${entry.code}|${entry.section}|${entry.target}|${entry.stockVersion}`;
  assert(
    shape === "organization-standard|organization|organization|1",
    `code|section|target|stockVersion: got ${shape}`,
  );
}

export function theEntryParsesUnderTheStockContract(): void {
  const parsed = stockDashboardTemplateDtoSchema.safeParse(entry);
  assert(parsed.success, `stockDashboardTemplateDtoSchema refused it: ${JSON.stringify(parsed.error?.issues)}`);
  const content = sectionTemplateContentSchema.safeParse(entry.content);
  assert(content.success, `sectionTemplateContentSchema refused it: ${JSON.stringify(content.error?.issues)}`);
}

export function theContentFitsTheOrganizationTarget(): void {
  const message = templateTargetContentMessage("organization", sectionTemplateContentSchema.parse(entry.content));
  assert(message === null, `the organization target rule refused it: ${message}`);
}

export function itHoldsFourteenValueTilesAndNoTabs(): void {
  assert(entry.content.tabs.length === 0, `an organization template holds no tabs, got ${entry.content.tabs.length}`);
  const types = entry.content.widgets.map((widget) => widget.widgetType);
  assert(types.length === 14, `expected 14 tiles, got ${types.length}`);
  assert(
    types.every((type) => type === "value_tile"),
    `every widget must be a value_tile, got ${[...new Set(types)].join(",")}`,
  );
  assert(
    entry.content.widgets.every((widget) => widget.bindings.length === 0),
    "an organization tile binds catalog sources, never a role",
  );
}

/** Every source is a write the dashboard write path accepts: a known key with its own params. */
export function everySourceIsAValidCatalogWrite(): void {
  for (const widget of entry.content.widgets) {
    for (const source of widget.sources) {
      const parsed = sourceBindingWriteSchema.safeParse(source);
      assert(parsed.success, `${widget.key}: ${source.catalogKey} refused: ${JSON.stringify(parsed.error?.issues)}`);
    }
  }
}

/**
 * ADR 0112 decision 6, in order, as Amendment 1 row 3 and Amendment 2 row 6 read it:
 * `title → key {params}` per tile, with tile 3 binding the open and the critical count
 * (ruling Q1b) and tile 6 the intake stage only.
 */
const DECISION_6 = [
  "Total load → sustainability.total {kw,sum}",
  "Sites live → sites.live.count {}",
  "Open alarms → alarms.active.count {} + alarms.critical.count {}",
  "PUE → pue.ratio {}",
  "Energy today → sustainability.total {kwh_today,sum}",
  "Water today → sustainability.total {kl_today,sum,intake}",
  "Assets offline → assets.offline.count {}",
  "Asset health → assets.health.score {}",
  "Open work orders → workorders.open.count {}",
  "Energy cost today → sustainability.total {energy_cost_today,sum}",
  "Water cost today → sustainability.total {water_cost_today,sum}",
  "Energy cost this month → sustainability.total {energy_cost_this_month,sum}",
  "Water cost this month → sustainability.total {water_cost_this_month,sum}",
  "Availability (24 h) → sustainability.total {availability_pct_24h,avg}",
];

function describeSource(source: { catalogKey: string; params: Record<string, unknown> }): string {
  return `${source.catalogKey} {${Object.values(source.params).join(",")}}`;
}

export function theTilesAreDecisionSixInOrder(): void {
  const ordered = [...entry.content.widgets].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  const got = ordered.map(
    (widget) =>
      `${widget.title ?? ""} → ${[...widget.sources]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((source) => describeSource(source as { catalogKey: string; params: Record<string, unknown> }))
        .join(" + ")}`,
  );
  assert(JSON.stringify(got) === JSON.stringify(DECISION_6), `tiles in grid order: got ${JSON.stringify(got, null, 1)}`);
  assert(
    JSON.stringify(entry.content.widgets.map((widget) => widget.key)) === JSON.stringify(ordered.map((widget) => widget.key)),
    "the widgets must be declared in their grid order",
  );
}

/** Tile 3: the open count first (the primary, sortOrder 0), the critical count second. */
export function theOpenAlarmsTileBindsTheOpenAndTheCriticalCount(): void {
  const tile = entry.content.widgets.find((widget) => widget.title === "Open alarms");
  const sources = (tile?.sources ?? []).map((source) => `${source.sortOrder}:${source.catalogKey}`).join(",");
  assert(sources === "0:alarms.active.count,1:alarms.critical.count", `Open alarms sources: got ${sources}`);
}

/**
 * ADR 0112 Amendment 2 — tile 6 sums the intake stage only, `{ kl_today, sum, balanceRole:
 * "intake" }` as the sustainability-overview stock tile does: without the role the sum counts
 * every water stage's inlet and overcounts a multi-stage plant. Pinned key by key, so a
 * reordered or extra param reddens here and not only in the decision 6 row.
 */
export function theWaterTodayTileSumsTheIntakeStageOnly(): void {
  const tile = entry.content.widgets.find((widget) => widget.title === "Water today");
  const got = JSON.stringify(tile?.sources ?? []);
  const want = JSON.stringify([
    {
      catalogKey: "sustainability.total",
      params: { pointKey: "kl_today", aggregate: "sum", balanceRole: "intake" },
      sortOrder: 0,
    },
  ]);
  assert(got === want, `Water today sources: got ${got}`);
}

/** Owner ruling 6 — "vs yesterday" on Total load and Open alarms only. */
export function exactlyTheLoadAndAlarmTilesCompare(): void {
  const comparing = entry.content.widgets
    .filter((widget) => widget.widgetType === "value_tile" && widget.config.compareToPrevious === true)
    .map((widget) => widget.title);
  assert(
    JSON.stringify(comparing) === JSON.stringify(["Total load", "Open alarms"]),
    `compareToPrevious tiles: got ${JSON.stringify(comparing)}`,
  );
}

/**
 * The cost tiles carry no unit: the resolve's `currency` is the organization's (ADR 0112
 * decision 6, ADR 0070 decision 8), and a typed unit would be one currency for every tenant.
 */
export function theCostTilesTypeNoUnit(): void {
  const costs = entry.content.widgets.filter((widget) => /cost/i.test(widget.title ?? ""));
  assert(costs.length === 4, `expected four cost tiles, got ${costs.length}`);
  for (const widget of costs) {
    const unit = widget.widgetType === "value_tile" ? widget.config.unit : undefined;
    assert(unit === undefined, `${widget.key} types the unit "${String(unit)}"`);
  }
}

/** Four tiles a row, each the SMOC tile size, rows packed from the top-left with no overlap. */
export function theTilesSitFourToARow(): void {
  const width = DASHBOARD_GRID.columns / 4;
  entry.content.widgets.forEach((widget, index) => {
    const want = `${(index % 4) * width},${Math.floor(index / 4) * 2},${width},2`;
    const got = `${widget.gridX},${widget.gridY},${widget.gridW},${widget.gridH}`;
    assert(got === want, `${widget.key} at ${got}, wanted ${want}`);
  });
}
