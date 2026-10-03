import type { SectionTemplateContent, SectionTemplateWidget } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import { planOverviewUpgrade } from "./site-layout-seed-upgrade";
import {
  electricalTilesTheCopyKeeps,
  planElectricalV4Upgrade,
  planOverviewV4Upgrade,
  type TabCopyWidget,
  type TabUpgradePlan,
} from "./site-layout-seed-upgrade-tabs";
import {
  canonicalJson,
  type GridRect,
  OVERVIEW_V2_WIDGETS,
  OVERVIEW_V3_WIDGETS,
  SLD_V3_WIDGETS,
  smocStandardV2Content,
} from "./site-layout-stock-history";

/**
 * `F3.74` (ADR 0088 Amendment 2) — the v3 → v4 tab steps of the seed upgrade chain: the Overview
 * gains the compact electrical diagram beside the class strip, and the electrical tab draws
 * `lv_single_line` with a breaker table under it. Per tab, and only while the tab holds exactly
 * what the copy rule left at v3. Assertions live here; `site-layout-seed-upgrade-tabs.test.ts` is
 * the Vitest entry point (ADR 0014). The database half is
 * `tests/f3.74-site-layout-v4-upgrade.integration.test.ts`.
 *
 * The fixtures are written from the frozen v3 widgets with literal rects, never packed by the
 * function under test, so a planner that packs wrongly cannot also build its own expectation.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const live = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;

/** One template widget as a copy stores it: its rect (or `rect`), its config, its row counts. */
function stored(
  tabKey: string,
  widget: SectionTemplateWidget,
  overrides: Partial<TabCopyWidget> = {},
): TabCopyWidget {
  return {
    id: `${tabKey}/${widget.key}`,
    tabKey,
    widgetType: widget.widgetType,
    title: widget.title,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    points: 0,
    sources: widget.sources.length,
    config: widget.config,
    ...overrides,
  };
}

const at = (gridX: number, gridY: number, gridW: number, gridH: number): GridRect => ({ gridX, gridY, gridW, gridH });

/** The v3 Overview as the copy rule left it (v3 has no card, so every copy holds all eight). */
function v3Overview(): TabCopyWidget[] {
  return OVERVIEW_V3_WIDGETS.map((widget) => stored("overview", widget));
}

/** The live (v4) Overview as a copy with an `sld` tab stores it. */
function v4Overview(): TabCopyWidget[] {
  const tab = live.tabs.find((candidate) => candidate.key === "overview");
  return (tab?.widgets ?? []).map((widget) => stored("overview", widget));
}

const v3Sld = (key: string): SectionTemplateWidget => {
  const widget = SLD_V3_WIDGETS.find((candidate) => candidate.key === key);
  assert(widget !== undefined, `no v3 sld widget ${key}`);
  return widget as SectionTemplateWidget;
};

/**
 * CSMOC Gauteng's v3 `sld` tab as the copy left it: the Main bus load tile (one point row) packed
 * to `0,0`, the three unbound tiles absent, the mimic, the rail and the table where v3 has them.
 */
function csmocV3Sld(): TabCopyWidget[] {
  return [
    stored("sld", v3Sld("sld-main-bus-kw-tile"), { ...at(0, 0, 3, 2), points: 1 }),
    stored("sld", v3Sld("sld-mimic")),
    stored("sld", v3Sld("sld-alarms-rail")),
    stored("sld", v3Sld("sld-assets-table")),
  ];
}

/** A PHE station's v3 `sld` tab with only the Frequency tile bound, packed to `0,0`. */
function pheV3Sld(): TabCopyWidget[] {
  return [stored("sld", v3Sld("sld-frequency-tile"), { ...at(0, 0, 3, 2), points: 1 }), ...csmocV3Sld().slice(1)];
}

/** A v3 `sld` tab no tile was kept on: the mimic lifted to `0,0`, the rail and table to `y7`. */
function untiledV3Sld(): TabCopyWidget[] {
  return [
    stored("sld", v3Sld("sld-mimic"), at(0, 0, 12, 7)),
    stored("sld", v3Sld("sld-alarms-rail"), at(0, 7, 6, 5)),
    stored("sld", v3Sld("sld-assets-table"), at(6, 7, 6, 5)),
  ];
}

/**
 * The `sld` role tiles the copy rule keeps today, by template key — what the runner derives from
 * the tab's group and the site's active points (`electricalTilesTheCopyKeeps`).
 */
const CSMOC_TILES: ReadonlySet<string> = new Set(["sld-main-bus-kw-tile"]);
const PHE_TILES: ReadonlySet<string> = new Set(["sld-frequency-tile"]);
const NO_TILES: ReadonlySet<string> = new Set();
const ALL_TILES: ReadonlySet<string> = new Set([
  "sld-incomer-kw-tile",
  "sld-incomer-pf-tile",
  "sld-frequency-tile",
  "sld-main-bus-kw-tile",
]);

/**
 * A v3 `sld` tab whose first three tiles were kept (each with a point row) at their v3 rects, and
 * "Main bus load" (the trailing tile, `9,0`) absent; the mimic, rail and table at their v3 rects.
 */
function threeTileV3Sld(): TabCopyWidget[] {
  return [
    stored("sld", v3Sld("sld-incomer-kw-tile"), { points: 1 }),
    stored("sld", v3Sld("sld-incomer-pf-tile"), { points: 1 }),
    stored("sld", v3Sld("sld-frequency-tile"), { points: 1 }),
    ...csmocV3Sld().slice(1),
  ];
}

const CSMOC_TABS = ["overview", "sld", "ups", "hvac", "water"];
const PHE_TABS = ["overview", "sld", "env"];
const NO_SLD_TABS = ["overview", "env"];

const rect = (r: GridRect): string => `${r.gridX},${r.gridY},${r.gridW},${r.gridH}`;

/** A plan as one string: every list, in the order the planner gives it. */
export function planText(plan: TabUpgradePlan): string {
  return [
    `deletes=${plan.deletes.map((op) => op.id).join(",")}`,
    `updates=${plan.updates.map((op) => `${op.id}@${rect(op.to)}${canonicalJson(op.toConfig)}`).join(",")}`,
    `moves=${plan.moves.map((op) => `${op.id}@${rect(op.from)}>${rect(op.to)}`).join(",")}`,
    `inserts=${plan.inserts.map((op) => `${op.tabKey}|${op.widgetType}|${op.title ?? ""}@${rect(op.to)}${canonicalJson(op.config)}`).join(",")}`,
  ].join(" ");
}

const NOTHING = "deletes= updates= moves= inserts=";

const OVERVIEW_V4_PLAN =
  "deletes= updates= " +
  "moves=overview/overview-class-strip@0,9,12,2>6,9,6,2 " +
  'inserts=overview|mimic|@0,9,6,2{"compact":true,"preset":"lv_single_line","source":"preset","tabKey":"sld"}';

// ---- the Overview, v3 → v4 -------------------------------------------------------------------

/** U1 — CSMOC's v3 Overview: the compact diagram inserted, the strip moved beside it. */
export function aCsmocV3OverviewGainsTheCompactDiagram(): void {
  const got = planText(planOverviewV4Upgrade(v3Overview(), CSMOC_TABS));
  assert(got === OVERVIEW_V4_PLAN, got);
}

/** U2 — a PHE station's v3 Overview gets the same plan. */
export function aPheV3OverviewGainsTheCompactDiagram(): void {
  const got = planText(planOverviewV4Upgrade(v3Overview(), PHE_TABS));
  assert(got === OVERVIEW_V4_PLAN, got);
}

/** U2b — a copy with no `sld` tab gets no diagram, and its strip is packed to `0,9,6,2`. */
export function anOverviewWithNoElectricalTabGetsNoDiagram(): void {
  const got = planText(planOverviewV4Upgrade(v3Overview(), NO_SLD_TABS));
  assert(got === "deletes= updates= moves=overview/overview-class-strip@0,9,12,2>0,9,6,2 inserts=", got);
}

/** U3 — one tile one row down keeps the Overview. */
export function aMovedTileKeepsTheOverview(): void {
  const moved = v3Overview().map((widget) =>
    widget.title === "Total load" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const got = planText(planOverviewV4Upgrade(moved, CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U4 — a widget added by an administrator keeps the Overview. */
export function anAddedWidgetKeepsTheOverview(): void {
  const extra: TabCopyWidget = {
    id: "overview/mine", tabKey: "overview", widgetType: "table", title: "Mine",
    gridX: 0, gridY: 20, gridW: 6, gridH: 5, points: 0, sources: 0, config: {},
  };
  const got = planText(planOverviewV4Upgrade([...v3Overview(), extra], CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U4 — a widget an administrator deleted keeps the Overview. */
export function aDeletedWidgetKeepsTheOverview(): void {
  const deleted = v3Overview().filter((widget) => widget.widgetType !== "state_legend");
  const got = planText(planOverviewV4Upgrade(deleted, CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U4 — a repeated widget keeps the Overview. */
export function aRepeatedWidgetKeepsTheOverview(): void {
  const base = v3Overview();
  const repeated = [...base, { ...(base[7] as TabCopyWidget), id: "overview/legend-2" }];
  const got = planText(planOverviewV4Upgrade(repeated, CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U5 — the rail's `rows` edited keeps the Overview. */
export function anEditedRailKeepsTheOverview(): void {
  const edited = v3Overview().map((widget) =>
    widget.widgetType === "active_alarms_rail" ? { ...widget, config: { rows: 12, showSummary: true } } : widget,
  );
  const got = planText(planOverviewV4Upgrade(edited, CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U6 — a legend holding a point row keeps the Overview. */
export function aBoundLegendKeepsTheOverview(): void {
  const bound = v3Overview().map((widget) => (widget.widgetType === "state_legend" ? { ...widget, points: 1 } : widget));
  const got = planText(planOverviewV4Upgrade(bound, CSMOC_TABS));
  assert(got === NOTHING, got);
}

/** U7 — a v4 Overview is not upgraded again. */
export function aV4OverviewIsNotUpgradedAgain(): void {
  const got = planText(planOverviewV4Upgrade(v4Overview(), CSMOC_TABS));
  assert(got === NOTHING, got);
}

/**
 * U7 — the v2 → v3 step given a v4 Overview, with the live (v4) content as its `to`, writes
 * nothing and does not throw. `to` is the live entry on purpose: it holds the compact diagram,
 * which v2 does not, so a restored "new in the target version" throw fires here.
 */
export function theV3StepLeavesAV4OverviewAndDoesNotThrow(): void {
  let got: string;
  try {
    const plan = planOverviewUpgrade(v4Overview(), CSMOC_TABS, smocStandardV2Content(), live);
    got = `${plan.deletes.length}/${plan.updates.length}/${plan.inserts.length}`;
  } catch (error) {
    got = `threw: ${(error as Error).message}`;
  }
  assert(got === "0/0/0", got);
}

/** U8 — the v2 → v3 step on a PHE packed v2 Overview: the v3 updates, in v2 order, no insert. */
export function theV3StepStillMovesAPackedV2OverviewToV3(): void {
  let slot = 0;
  const packedV2 = OVERVIEW_V2_WIDGETS.flatMap((widget) => {
    if (widget.widgetType !== "module_summary_card") return [stored("overview", widget)];
    if (!PHE_TABS.includes(widget.config.targetTabKey)) return [];
    const card = stored("overview", widget, { gridX: slot * 2 });
    slot += 1;
    return [card];
  });
  const plan = planOverviewUpgrade(packedV2, PHE_TABS);
  const got =
    plan.updates.map((op) => `${op.id}@${rect(op.to)}${canonicalJson(op.toConfig)}`).join(";") +
    ` inserts=${plan.inserts.length}`;
  const want =
    "overview/overview-legend@0,11,12,1{};" +
    'overview/overview-alarms-tile@0,0,3,2{"icon":"alert"};' +
    'overview/overview-load-tile@6,0,3,2{"icon":"bolt","unit":"kW"};' +
    'overview/overview-health-tile@9,0,3,2{"icon":"gauge"};' +
    'overview/overview-offline-tile@3,0,3,2{"icon":"offline"};' +
    "overview/overview-class-strip@0,9,12,2{};" +
    'overview/overview-alarms-rail@0,2,8,7{"rows":8,"showSummary":true};' +
    "overview/overview-critical-systems@8,2,4,7{} inserts=0";
  assert(got === want, got);
}

// ---- the electrical tab, v3 → v4 -------------------------------------------------------------

const ELECTRICAL_V4_PLAN =
  "deletes= " +
  'updates=sld/sld-mimic@0,2,12,7{"preset":"lv_single_line","source":"preset"} ' +
  "moves=sld/sld-alarms-rail@0,9,6,5>0,14,6,5,sld/sld-assets-table@6,9,6,5>6,14,6,5 " +
  "inserts=sld|breaker_table|Breakers@0,9,12,5{}";

/** E1 — CSMOC's v3 `sld` tab: the single line, the rail and table down five, the breaker table. */
export function aCsmocV3ElectricalTabGainsTheBreakerTable(): void {
  const got = planText(planElectricalV4Upgrade(csmocV3Sld(), CSMOC_TILES));
  assert(got === ELECTRICAL_V4_PLAN, got);
}

/** E2 — a PHE `sld` with only Frequency bound gets the same three ops. */
export function aPheV3ElectricalTabGainsTheBreakerTable(): void {
  const got = planText(planElectricalV4Upgrade(pheV3Sld(), PHE_TILES));
  assert(got === ELECTRICAL_V4_PLAN, got);
}

/** E2b — an `sld` that kept no tile: the breaker table at `0,7`, the lower row to `y12`. */
export function anUntiledElectricalTabGetsThePackedBreakerTable(): void {
  const got = planText(planElectricalV4Upgrade(untiledV3Sld(), NO_TILES));
  assert(
    got ===
      'deletes= updates=sld/sld-mimic@0,0,12,7{"preset":"lv_single_line","source":"preset"} ' +
        "moves=sld/sld-alarms-rail@0,7,6,5>0,12,6,5,sld/sld-assets-table@6,7,6,5>6,12,6,5 " +
        "inserts=sld|breaker_table|Breakers@0,7,12,5{}",
    got,
  );
}

/** E3 — the rail moved by an administrator keeps the electrical tab. */
export function aMovedRailKeepsTheElectricalTab(): void {
  const moved = csmocV3Sld().map((widget) =>
    widget.widgetType === "active_alarms_rail" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const got = planText(planElectricalV4Upgrade(moved, CSMOC_TILES));
  assert(got === NOTHING, got);
}

/** E4 — a kept role tile holding no point row keeps the electrical tab. */
export function anUnboundKeptTileKeepsTheElectricalTab(): void {
  const unbound = csmocV3Sld().map((widget) => (widget.widgetType === "value_tile" ? { ...widget, points: 0 } : widget));
  const got = planText(planElectricalV4Upgrade(unbound, CSMOC_TILES));
  assert(got === NOTHING, got);
}

/** E5 — a v4 `sld` tab is not upgraded again. */
export function aV4ElectricalTabIsNotUpgradedAgain(): void {
  const tab = live.tabs.find((candidate) => candidate.key === "sld");
  const v4 = (tab?.widgets ?? [])
    .filter((widget) => widget.key !== "sld-incomer-kw-tile" && widget.key !== "sld-incomer-pf-tile" && widget.key !== "sld-frequency-tile")
    .map((widget) => stored("sld", widget, widget.widgetType === "value_tile" ? { ...at(0, 0, 3, 2), points: 1 } : {}));
  const got = planText(planElectricalV4Upgrade(v4, CSMOC_TILES));
  assert(v4.length === 5 && got === NOTHING, `${v4.length} widgets: ${got}`);
}

/** E6 — a widget an administrator added keeps the electrical tab. */
export function anAddedWidgetKeepsTheElectricalTab(): void {
  const extra: TabCopyWidget = {
    id: "sld/mine", tabKey: "sld", widgetType: "table", title: "Mine",
    gridX: 0, gridY: 20, gridW: 6, gridH: 5, points: 0, sources: 0, config: {},
  };
  const got = planText(planElectricalV4Upgrade([...csmocV3Sld(), extra], CSMOC_TILES));
  assert(got === NOTHING, got);
}

/** E7 — a mimic config an administrator edited keeps the electrical tab. */
export function anEditedMimicKeepsTheElectricalTab(): void {
  const edited = csmocV3Sld().map((widget) =>
    widget.widgetType === "mimic" ? { ...widget, config: { source: "preset", preset: "electrical_distribution", compact: true } } : widget,
  );
  const got = planText(planElectricalV4Upgrade(edited, CSMOC_TILES));
  assert(got === NOTHING, got);
}

/**
 * E8 — every tile is bindable at the site and "Main bus load" is absent: the copy rule would have
 * kept it, so an administrator deleted it, and the tab is left whole. Its slot was the trailing
 * one, so nothing else moved, and a gate that read "absent" as "omitted" would write four ops.
 */
export function aDeletedBindableTileKeepsTheElectricalTab(): void {
  const got = planText(planElectricalV4Upgrade(threeTileV3Sld(), ALL_TILES));
  assert(got === NOTHING, got);
}

/** E9 — the same tab where "Main bus load" binds nothing at the site: the copy omitted it, so it moves. */
export function anAbsentUnbindableTileStillUpgrades(): void {
  const bindable = new Set([...ALL_TILES].filter((key) => key !== "sld-main-bus-kw-tile"));
  const got = planText(planElectricalV4Upgrade(threeTileV3Sld(), bindable));
  assert(got === ELECTRICAL_V4_PLAN, got);
}

/**
 * E10 — the tiles the copy keeps: a role tile whose role has a member with an active point of the
 * tile's key. CSMOC's shape: an `lt-panel` member with `kw`, a `meter` member without
 * `frequency_hz`, no `incoming-supply` member.
 */
export function theCopyKeepsTheTilesWhoseRoleHasThePoint(): void {
  const members = new Map([
    ["lt-panel", [{ assetId: "a-lt", code: "LT-1" }]],
    ["meter", [{ assetId: "a-meter", code: "M-1" }]],
  ]);
  const points = new Map([
    ["a-lt::kw", "p-1"],
    ["a-meter::kw", "p-2"],
  ]);
  const got = [...electricalTilesTheCopyKeeps(members, points)].sort().join(",");
  assert(got === "sld-main-bus-kw-tile", got);
}

/** The control for the per-tab gate: the Overview step reads the Overview only. */
export function theOverviewStepReadsTheOverviewOnly(): void {
  const got = planText(planOverviewV4Upgrade([...v3Overview(), ...csmocV3Sld()], CSMOC_TABS));
  assert(got === OVERVIEW_V4_PLAN, got);
}

/** The control for the per-tab gate: the electrical step reads the electrical tab only. */
export function theElectricalStepReadsTheElectricalTabOnly(): void {
  const got = planText(planElectricalV4Upgrade([...csmocV3Sld(), ...v3Overview()], CSMOC_TILES));
  assert(got === ELECTRICAL_V4_PLAN, got);
}
