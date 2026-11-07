import { stockDashboardTemplateDtoSchema, templateTargetContentMessage } from "../contracts/dashboard-templates";
import type { StockDashboardTemplateDto } from "../index";
import { planSiteLayout, type SiteLayoutGroup } from "../site-layout-planner";
import { PUMP_STATION_STANDARD_SITE_TEMPLATE } from "./pump-station-standard";

/**
 * `F4.319` (ADR 0113 decision 7) — the pump-station standard site layout. Assertions live here;
 * `pump-station-standard.test.ts` is the Vitest entry point (ADR 0014). The role and point-key
 * vocabularies are checked by `stock-catalog.spec.ts` and `tests/f3.38-stock-catalog-vocabulary.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const entry: StockDashboardTemplateDto = PUMP_STATION_STANDARD_SITE_TEMPLATE;

export function theEntryIsTheSiteTargetStockRow(): void {
  const parsed = stockDashboardTemplateDtoSchema.safeParse(entry);
  assert(parsed.success, `does not parse: ${parsed.success ? "" : parsed.error.message}`);
  const shape = `${entry.code}|${entry.section}|${entry.target}|${entry.stockVersion}`;
  // `F4.332` (ADR 0112 Amendment 3 item 6) — v2 adds the energy cost row to the Electrical tab.
  assert(shape === "pump-station-standard|site|site|2", `code|section|target|stockVersion: got ${shape}`);
  assert(templateTargetContentMessage(entry.target, entry.content) === null, "the site target refuses the content");
}

/** Three tabs in order; the Overview names the `pump-station` group (plan D4). */
export function theTabsAreOverviewElectricalAndEnvironment(): void {
  const tabs = entry.content.tabs.map((tab) => `${tab.key}:${tab.domain ?? "-"}:${tab.groupCode ?? "-"}`).join(",");
  assert(
    tabs === "overview:-:pump-station,electrical:electrical:electrical,env:environment:environment",
    `tabs: got ${tabs}`,
  );
}

/** Each tab draws one mimic, its own pump-station preset; the Overview's is compact and names no tab. */
export function eachTabDrawsItsPumpStationPreset(): void {
  const want: Readonly<Record<string, string>> = {
    overview: "pump_station_overview",
    electrical: "pump_station_electrical",
    env: "pump_station_environment",
  };
  for (const tab of entry.content.tabs) {
    const mimics = tab.widgets.filter((widget) => widget.widgetType === "mimic");
    assert(mimics.length === 1, `${tab.key}: ${mimics.length} mimics`);
    const config = mimics[0]!.config as { source: string; preset?: string; tabKey?: string; compact?: boolean };
    assert(config.source === "preset" && config.preset === want[tab.key], `${tab.key} draws ${config.preset}`);
    assert(config.tabKey === undefined, `${tab.key}: the mimic names tabKey ${config.tabKey}`);
    assert((config.compact === true) === (tab.key === "overview"), `${tab.key}: compact is ${config.compact}`);
    if (tab.mimicPreset !== undefined) assert(tab.mimicPreset === want[tab.key], `${tab.key}: mimicPreset`);
  }
}

/** No two widgets of a tab overlap, and every widget lies inside the 12-column grid. */
export function noWidgetsOverlap(): void {
  for (const tab of entry.content.tabs) {
    const cells = new Set<string>();
    for (const w of tab.widgets) {
      assert(w.gridX >= 0 && w.gridX + w.gridW <= 12, `${w.key} leaves the grid`);
      for (let x = w.gridX; x < w.gridX + w.gridW; x += 1) {
        for (let y = w.gridY; y < w.gridY + w.gridH; y += 1) {
          const cell = `${x},${y}`;
          assert(!cells.has(cell), `${tab.key}: ${w.key} overlaps at ${cell}`);
          cells.add(cell);
        }
      }
    }
  }
}

const group = (code: string, domain: string | null): SiteLayoutGroup => ({ id: `grp-${code}`, code, name: code, domain });

/** At a seeded PHE station the plan keeps all three tabs, the Overview on `pump-station`, and drops nothing. */
export function aPheStationKeepsEveryTab(): void {
  const plan = planSiteLayout(entry.content.tabs, [
    group("electrical", "electrical"),
    group("environment", "environment"),
    group("pump-station", null),
  ]);
  assert(plan.status === "planned", `plan ${plan.status}`);
  if (plan.status !== "planned") return;
  const bound = plan.tabs.map((row) => `${row.tab.key}=${row.group?.code ?? "-"}`).join(",");
  assert(bound === "overview=pump-station,electrical=electrical,env=environment", `bound ${bound}`);
  assert(plan.droppedCards.length === 0, `dropped ${JSON.stringify(plan.droppedCards)}`);
}

/**
 * `F4.332` (ADR 0112 Amendment 3 item 6) — the Electrical tab ends with the three read-time cost
 * tiles and the daily cost chart reading 90 days (so the viewer switch offers 7 / 30 / 90).
 */
export function theElectricalTabCarriesTheCostRow(): void {
  const tab = PUMP_STATION_STANDARD_SITE_TEMPLATE.content.tabs.find((t) => t.key === "electrical");
  const cost = (tab?.widgets ?? []).filter((w) => w.sources.some((s) => s.catalogKey.startsWith("energy.cost")));
  const got = cost.map((w) => `${w.title} → ${w.sources.map((s) => `${s.catalogKey} ${JSON.stringify(s.params)}`).join("")}`);
  const want = [
    'Cost today → energy.cost.total {"period":"today"}',
    'Cost last 7 days → energy.cost.total {"period":"last_7_days"}',
    'Cost this month → energy.cost.total {"period":"this_month"}',
    'Daily energy cost → energy.cost_by_day {"days":90}',
  ];
  assert(JSON.stringify(got) === JSON.stringify(want), `the Electrical cost row: got ${JSON.stringify(got)}`);
  const chart = cost[3];
  assert(chart?.widgetType === "chart" && chart.config.series === "cost_by_day" && chart.gridW === 12, "a full-width cost_by_day chart");
  const lowest = Math.max(...(tab?.widgets ?? []).filter((w) => !cost.includes(w)).map((w) => w.gridY + w.gridH));
  assert(cost.every((w) => w.gridY >= lowest), "the cost row sits under every other widget of the tab");
}
