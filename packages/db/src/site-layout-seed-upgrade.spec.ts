import type { SectionTemplateContent } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  type CopyWidget,
  type GridRect,
  isSeedStockSiteTemplate,
  type OverviewCopyWidget,
  type PackCopyWidget,
  planCopyPackUpgrade,
  planCopyWidgetUpgrade,
  planOverviewUpgrade,
  SITE_LAYOUT_COPY_DESCRIPTION,
  SITE_LAYOUT_COPY_DESCRIPTION_V1,
  SMOC_STANDARD_CURRENT_RECTS,
  type SiteTemplateRow,
  siteWidgetIdentity,
  upgradedCopyDescription,
  upgradeSeededSiteLayoutCopies,
} from "./site-layout-seed-upgrade";
import {
  canonicalJson,
  OVERVIEW_V2_WIDGETS,
  SMOC_STANDARD_V1_RECTS,
  SMOC_STANDARD_V2_RECTS,
  smocStandardV1Content,
  smocStandardV2Content,
  smocStandardV3Content,
} from "./site-layout-stock-history";

/**
 * The SMOC standard site layout's seed upgrade chain — the pure decisions: v1 → v2 moves, the
 * pack step, the v2 → v3 Overview step and the template supersede rule. Assertions live here;
 * `site-layout-seed-upgrade.test.ts` is the Vitest entry point (ADR 0014). The database half is
 * `tests/f3.73-site-layout-seed.integration.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const current = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;
const v2 = smocStandardV2Content();

/** Every widget of v2's tab `tabKey`, as a copy stores it, at the rects of `rects`. */
function copyTab(tabKey: string, rects: ReadonlyMap<string, GridRect>, content: SectionTemplateContent = v2): CopyWidget[] {
  const tab = content.tabs.find((candidate) => candidate.key === tabKey);
  assert(tab !== undefined, `no tab ${tabKey}`);
  return (tab?.widgets ?? []).map((widget) => {
    const rect = rects.get(siteWidgetIdentity(tabKey, widget.widgetType, widget.title));
    assert(rect !== undefined, `no rect for ${tabKey}/${widget.key}`);
    return {
      id: `${tabKey}/${widget.key}`,
      tabKey,
      widgetType: widget.widgetType,
      title: widget.title,
      gridX: rect?.gridX ?? -1,
      gridY: rect?.gridY ?? -1,
      gridW: rect?.gridW ?? -1,
      gridH: rect?.gridH ?? -1,
    };
  });
}

function seedRow(overrides: Partial<SiteTemplateRow> = {}): SiteTemplateRow {
  return {
    id: "t1",
    version: 1,
    status: "published",
    stockVersion: 1,
    createdBy: null,
    content: smocStandardV1Content(),
    ...overrides,
  };
}

const moveText = (list: readonly { id: string; to: GridRect }[]): string =>
  list.map((move) => `${move.id}@${move.to.gridX},${move.to.gridY},${move.to.gridW},${move.to.gridH}`).join(";");

export function theV1DescriptionIsReplaced(): void {
  const next = upgradedCopyDescription(SITE_LAYOUT_COPY_DESCRIPTION_V1);
  assert(next === SITE_LAYOUT_COPY_DESCRIPTION, `got ${String(next)}`);
}

export function anEditedDescriptionIsKept(): void {
  const edited = upgradedCopyDescription(`${SITE_LAYOUT_COPY_DESCRIPTION_V1} `);
  const empty = upgradedCopyDescription(null);
  assert(edited === null && empty === null, `edited → ${String(edited)}, null → ${String(empty)}`);
}

export function theNewDescriptionNamesNoRowSeedOrDemo(): void {
  assert(!/F3\.73|seed|demo/i.test(SITE_LAYOUT_COPY_DESCRIPTION), SITE_LAYOUT_COPY_DESCRIPTION);
}

/** The copy's matching key is unique per tab: one identity per template widget, v2 and current. */
export function everyTemplateWidgetHasItsOwnIdentity(): void {
  for (const [label, content, rects] of [
    ["current", current, SMOC_STANDARD_CURRENT_RECTS],
    ["v2", v2, SMOC_STANDARD_V2_RECTS],
  ] as const) {
    const widgets = content.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0);
    assert(rects.size === widgets, `${label}: ${rects.size} identities, ${widgets} widgets`);
  }
}

export function theV1TableNamesExactlyTheV2Widgets(): void {
  const v1 = [...SMOC_STANDARD_V1_RECTS.keys()].sort().join(",");
  const v2Keys = [...SMOC_STANDARD_V2_RECTS.keys()].sort().join(",");
  assert(v1 === v2Keys, `v1 table: ${v1}\nv2: ${v2Keys}`);
}

export function aTabAtItsV1RectsMovesToV2(): void {
  const got = moveText(planCopyWidgetUpgrade(copyTab("ups", SMOC_STANDARD_V1_RECTS)));
  assert(
    got === "ups/ups-load-tile@0,0,3,2;ups/ups-backup-tile@3,0,3,2;ups/ups-alarms-rail@0,2,6,5;ups/ups-assets-table@6,2,6,5",
    `moves: ${got}`,
  );
}

/** The v1 Overview moves to the v2 rects, cards included: the default `to` is frozen v2. */
export function anOverviewAtItsV1RectsMovesToV2(): void {
  const moves = planCopyWidgetUpgrade(copyTab("overview", SMOC_STANDARD_V1_RECTS));
  // 13 of 14: the legend's v1 rect is its v2 rect.
  assert(moves.length === 13, `overview moves: ${moveText(moves)}`);
  const card = moves.find((move) => move.id === "overview/overview-hvac-card");
  assert(card !== undefined && moveText([card]) === "overview/overview-hvac-card@4,6,2,3", `card: ${moveText(moves)}`);
}

/** One moved widget keeps its whole tab, and another tab still moves. */
export function aMovedWidgetKeepsItsTab(): void {
  const sld = copyTab("sld", SMOC_STANDARD_V1_RECTS).map((widget) =>
    widget.widgetType === "active_alarms_rail" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const moves = planCopyWidgetUpgrade([...sld, ...copyTab("ups", SMOC_STANDARD_V1_RECTS)]);
  const tabs = [...new Set(moves.map((move) => move.id.split("/")[0]))].join(",");
  assert(tabs === "ups", `tabs moved: ${tabs}`);
}

export function aWidgetTheTemplateDoesNotHoldKeepsItsTab(): void {
  const extra: CopyWidget = { id: "hvac/extra", tabKey: "hvac", widgetType: "table", title: "Mine", gridX: 0, gridY: 30, gridW: 6, gridH: 5 };
  const moves = planCopyWidgetUpgrade([...copyTab("hvac", SMOC_STANDARD_V1_RECTS), extra]);
  assert(moves.length === 0, `moves: ${moves.map((move) => move.id).join(",")}`);
  assert(planCopyWidgetUpgrade(copyTab("hvac", SMOC_STANDARD_V1_RECTS)).length === 6, "the unedited hvac tab moves 6");
}

export function aTabAlreadyAtV2WritesNothing(): void {
  const moves = planCopyWidgetUpgrade(copyTab("overview", SMOC_STANDARD_V2_RECTS));
  assert(moves.length === 0, `moves: ${moves.map((move) => move.id).join(",")}`);
}

// ---- the template supersede rule (plan D6, ruling 9) -----------------------------------------

export function theSeedsOlderStockRowsAreSuperseded(): void {
  const cases: [string, SiteTemplateRow][] = [
    ["stock 1 at version 1", seedRow()],
    ["stock 2 at version 1", seedRow({ stockVersion: 2, content: smocStandardV2Content() })],
    ["stock 2 at version 2", seedRow({ version: 2, stockVersion: 2, content: smocStandardV2Content() })],
  ];
  for (const [label, row] of cases) {
    assert(isSeedStockSiteTemplate(row, 3), `${label} is not superseded`);
  }
}

/** `F3.74`: the stock-3 row the v3 seed published is superseded once the current stock is 4. */
export function theSeedsStockThreeRowIsSupersededByStockFour(): void {
  const row = seedRow({ version: 2, stockVersion: 3, content: smocStandardV3Content() });
  assert(isSeedStockSiteTemplate(row, 4), "stock 3 at version 2 is not superseded by stock 4");
  assert(!isSeedStockSiteTemplate(row, 3), "stock 3 at version 2 is superseded by stock 3");
}

export function aTemplateRowTheSeedDoesNotOwnIsKept(): void {
  const cases: [string, SiteTemplateRow | undefined][] = [
    ["absent", undefined],
    ["an author", seedRow({ createdBy: "u1" })],
    ["a draft", seedRow({ status: "draft" })],
    ["an archived row", seedRow({ status: "archived" })],
    ["the current stock", seedRow({ stockVersion: 3, content: current })],
    ["a newer stock", seedRow({ stockVersion: 4, content: current })],
    ["no stock stamp", seedRow({ stockVersion: null })],
    ["content that does not parse", seedRow({ content: { tabs: "x" } })],
  ];
  for (const [label, row] of cases) {
    assert(!isSeedStockSiteTemplate(row, 3), `${label} was taken for the seed's own older row`);
  }
  assert(isSeedStockSiteTemplate(seedRow({ stockVersion: 2 }), 3), "the seed's stock-2 row is not recognised");
}

/** The default current version is the live stock entry's. */
export function theDefaultCurrentVersionIsTheLiveStock(): void {
  const live = SMOC_STANDARD_SITE_TEMPLATE.stockVersion;
  assert(isSeedStockSiteTemplate(seedRow({ stockVersion: live - 1 })), `stock ${live - 1} is kept`);
  assert(!isSeedStockSiteTemplate(seedRow({ stockVersion: live })), `stock ${live} is superseded`);
}

// ---- the v2 → packed step (the F3.73 design critique) ----------------------------------------

/** Tab `tabKey` at v2 rects; `bound` names the tiles holding a point (by widget title). */
function packTab(tabKey: string, bound: readonly string[] = []): PackCopyWidget[] {
  return copyTab(tabKey, SMOC_STANDARD_V2_RECTS).map((widget) => ({
    ...widget,
    points: bound.includes(widget.title ?? "") ? 1 : 0,
    sources: tabKey === "overview" && widget.widgetType === "value_tile" ? 1 : 0,
  }));
}

/** A PHE station's Overview as the earlier seed wrote it: the ups/hvac/it/water cards dropped. */
function pheOverview(): PackCopyWidget[] {
  const absent = ["UPS & battery", "HVAC", "IT", "Water"];
  return packTab("overview").filter(
    (widget) => !(widget.widgetType === "module_summary_card" && absent.includes(widget.title ?? "")),
  );
}

const PHE_TABS = ["overview", "sld", "env"];
const rects = (list: readonly { id: string; to: GridRect }[]): string =>
  list.map((move) => `${move.id}@${move.to.gridX},${move.to.gridY}`).join(";");

export function anUnpackedOverviewHasItsCardsPacked(): void {
  const { moves, deletes } = planCopyPackUpgrade(pheOverview(), PHE_TABS);
  assert(rects(moves) === "overview/overview-env-card@2,6", `overview moves: ${rects(moves)}`);
  assert(deletes.length === 0, `overview deletes: ${deletes.length}`);
}

export function anUnboundTileIsDeletedAndTheRowPacked(): void {
  const { moves, deletes } = planCopyPackUpgrade(packTab("sld", ["Frequency"]), PHE_TABS);
  assert(
    deletes.map((tile) => tile.id).join(",") ===
      "sld/sld-incomer-kw-tile,sld/sld-incomer-pf-tile,sld/sld-main-bus-kw-tile",
    `sld deletes: ${deletes.map((tile) => tile.id).join(",")}`,
  );
  assert(rects(moves) === "sld/sld-frequency-tile@0,0", `sld moves: ${rects(moves)}`);
}

export function aTabThatLosesEveryTileIsLifted(): void {
  const { moves } = planCopyPackUpgrade(packTab("env"), PHE_TABS);
  assert(
    rects(moves) === "env/env-mimic@0,0;env/env-alarms-rail@0,7;env/env-assets-table@6,7",
    `env moves: ${rects(moves)}`,
  );
}

export function anEditedTabIsNotPacked(): void {
  const moved = packTab("sld").map((widget) =>
    widget.widgetType === "active_alarms_rail" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const deleted = packTab("env").filter((widget) => widget.widgetType !== "table");
  const plan = planCopyPackUpgrade([...moved, ...deleted, ...pheOverview()], PHE_TABS);
  const tabs = [...new Set([...plan.moves, ...plan.deletes].map((row) => row.id.split("/")[0]))].join(",");
  assert(tabs === "overview", `tabs packed: ${tabs}`);
}

export function aPackedTabIsNotPackedAgain(): void {
  const first = planCopyPackUpgrade(packTab("env"), PHE_TABS);
  const after = packTab("env")
    .filter((widget) => !first.deletes.some((tile) => tile.id === widget.id))
    .map((widget) => ({ ...widget, ...first.moves.find((move) => move.id === widget.id)?.to }));
  const second = planCopyPackUpgrade(after, PHE_TABS);
  assert(second.moves.length + second.deletes.length === 0, `second run: ${rects(second.moves)}`);
  assert(first.deletes.length === 2, `first run deletes: ${first.deletes.length}`);
}

export function aFullyBoundTabWritesNothing(): void {
  const plan = planCopyPackUpgrade(packTab("hvac", ["Supply air", "Return air", "Cooling load"]), ["overview", "hvac"]);
  assert(plan.moves.length + plan.deletes.length === 0, `hvac: ${rects(plan.moves)}`);
}

// ---- the v2 → v3 Overview step (F3.77 plan D5) -----------------------------------------------

/**
 * A copy's Overview at its packed v2 plan: the v2 widgets less the cards of tabs the copy does
 * not hold, the kept cards packed left, every widget with its v2 config; the four tiles hold
 * one source row each. `cards` lists the kept cards' target tabs.
 */
function packedV2Overview(cards: readonly string[]): OverviewCopyWidget[] {
  let slot = 0;
  return OVERVIEW_V2_WIDGETS.flatMap((widget) => {
    let gridX = widget.gridX;
    if (widget.widgetType === "module_summary_card") {
      if (!cards.includes(widget.config.targetTabKey)) return [];
      gridX = slot * 2;
      slot += 1;
    }
    return [
      {
        id: `overview/${widget.key}`,
        tabKey: "overview",
        widgetType: widget.widgetType,
        title: widget.title,
        gridX,
        gridY: widget.gridY,
        gridW: widget.gridW,
        gridH: widget.gridH,
        points: 0,
        sources: widget.widgetType === "value_tile" ? 1 : 0,
        config: widget.config,
      },
    ];
  });
}

/** The frozen v3 Overview as a copy stores it (the live entry is v4 since F3.74). */
function v3Overview(): OverviewCopyWidget[] {
  const tab = smocStandardV3Content().tabs.find((candidate) => candidate.key === "overview");
  return (tab?.widgets ?? []).map((widget) => ({
    id: `overview/${widget.key}`,
    tabKey: "overview",
    widgetType: widget.widgetType,
    title: widget.title,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    points: 0,
    sources: widget.widgetType === "value_tile" ? 1 : 0,
    config: widget.config,
  }));
}

const PHE_CARDS = ["sld", "env"];
const CSMOC_TABS = ["overview", "sld", "ups", "hvac", "water"];
const CSMOC_CARDS = ["sld", "ups", "hvac", "water"];

/** The v3 updates every v2 Overview gets, whatever cards it held (ops in v2 template order). */
const V3_UPDATES =
  "overview/overview-legend@0,11,12,1{};" +
  "overview/overview-alarms-tile@0,0,3,2{\"icon\":\"alert\"};" +
  "overview/overview-load-tile@6,0,3,2{\"icon\":\"bolt\",\"unit\":\"kW\"};" +
  "overview/overview-health-tile@9,0,3,2{\"icon\":\"gauge\"};" +
  "overview/overview-offline-tile@3,0,3,2{\"icon\":\"offline\"};" +
  "overview/overview-class-strip@0,9,12,2{};" +
  "overview/overview-alarms-rail@0,2,8,7{\"rows\":8,\"showSummary\":true};" +
  "overview/overview-critical-systems@8,2,4,7{}";

function updateText(plan: ReturnType<typeof planOverviewUpgrade>): string {
  return plan.updates
    .map((op) => `${op.id}@${op.to.gridX},${op.to.gridY},${op.to.gridW},${op.to.gridH}${canonicalJson(op.toConfig)}`)
    .join(";");
}

export function aPhePackedV2OverviewMovesToV3(): void {
  const plan = planOverviewUpgrade(packedV2Overview(PHE_CARDS), PHE_TABS);
  assert(
    plan.deletes.map((op) => `${op.id}@${op.from.gridX}`).join(",") ===
      "overview/overview-sld-card@0,overview/overview-env-card@2",
    `deletes: ${plan.deletes.map((op) => op.id).join(",")}`,
  );
  assert(updateText(plan) === V3_UPDATES, `updates: ${updateText(plan)}`);
}

/** The Offline tile's update carries the v3 `offline` icon from the v2 `alert` one. */
export function theOfflineTileGetsTheOfflineIcon(): void {
  const plan = planOverviewUpgrade(packedV2Overview(PHE_CARDS), PHE_TABS);
  const tile = plan.updates.find((op) => op.id === "overview/overview-offline-tile");
  assert(tile !== undefined, `no Offline tile update: ${updateText(plan)}`);
  assert(canonicalJson(tile?.fromConfig) === '{"icon":"alert"}', `from ${canonicalJson(tile?.fromConfig)}`);
  assert(canonicalJson(tile?.toConfig) === '{"icon":"offline"}', `to ${canonicalJson(tile?.toConfig)}`);
  const list = plan.updates.find((op) => op.id === "overview/overview-critical-systems");
  assert(list?.title === "Critical systems", `the list's title: ${String(list?.title)}`);
}

export function aCsmocPackedV2OverviewMovesToV3(): void {
  const plan = planOverviewUpgrade(packedV2Overview(CSMOC_CARDS), CSMOC_TABS);
  assert(
    plan.deletes.map((op) => `${op.widgetType}@${op.from.gridX}`).join(",") ===
      "module_summary_card@0,module_summary_card@2,module_summary_card@4,module_summary_card@6",
    `deletes: ${plan.deletes.map((op) => op.id).join(",")}`,
  );
  assert(updateText(plan) === V3_UPDATES, `updates: ${updateText(plan)}`);
}

/** One card an administrator moved by one row keeps the whole Overview; unmoved, it upgrades. */
export function aMovedCardKeepsTheOverview(): void {
  const moved = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-env-card" ? { ...widget, gridY: widget.gridY + 1 } : widget,
  );
  const plan = planOverviewUpgrade(moved, PHE_TABS);
  assert(plan.deletes.length + plan.updates.length === 0, `moved card: ${updateText(plan)}`);
  assert(planOverviewUpgrade(packedV2Overview(PHE_CARDS), PHE_TABS).updates.length === 8, "the unmoved control");
}

/** An Overview still holding a card its copy lacks (not packed yet) is not the packed plan. */
export function anUnpackedOverviewIsNotUpgraded(): void {
  const unpacked = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-env-card" ? { ...widget, gridX: 8 } : widget,
  );
  const plan = planOverviewUpgrade(unpacked, PHE_TABS);
  assert(plan.deletes.length + plan.updates.length === 0, `unpacked: ${updateText(plan)}`);
}

export function aTileWithNoSourceRowKeepsTheOverview(): void {
  const unsourced = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-health-tile" ? { ...widget, sources: 0 } : widget,
  );
  const pointed = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-legend" ? { ...widget, points: 1 } : widget,
  );
  for (const [label, widgets] of [["no source", unsourced], ["a point row", pointed]] as const) {
    const plan = planOverviewUpgrade(widgets, PHE_TABS);
    assert(plan.deletes.length + plan.updates.length === 0, `${label}: ${updateText(plan)}`);
  }
}

/** A config an administrator changed keeps the Overview — here the Offline icon set by hand. */
export function anEditedConfigKeepsTheOverview(): void {
  const edited = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-offline-tile" ? { ...widget, config: { icon: "offline" } } : widget,
  );
  const plan = planOverviewUpgrade(edited, PHE_TABS);
  assert(plan.deletes.length + plan.updates.length === 0, `edited config: ${updateText(plan)}`);
}

/** A stored config in another key order is the same config (jsonb reorders keys). */
export function aReorderedConfigStillUpgrades(): void {
  const reordered = packedV2Overview(PHE_CARDS).map((widget) =>
    widget.id === "overview/overview-alarms-rail" ? { ...widget, config: { showSummary: true, rows: 8 } } : widget,
  );
  assert(planOverviewUpgrade(reordered, PHE_TABS).updates.length === 8, "a reordered config was taken for an edit");
}

export function anAddedOrRepeatedWidgetKeepsTheOverview(): void {
  const base = packedV2Overview(PHE_CARDS);
  const extra: OverviewCopyWidget = {
    id: "overview/mine", tabKey: "overview", widgetType: "table", title: "Mine",
    gridX: 0, gridY: 20, gridW: 6, gridH: 5, points: 0, sources: 0, config: {},
  };
  const repeated = [...base, { ...(base[0] as OverviewCopyWidget), id: "overview/legend-2" }];
  for (const [label, widgets] of [["added", [...base, extra]], ["repeated", repeated]] as const) {
    const plan = planOverviewUpgrade(widgets, PHE_TABS);
    assert(plan.deletes.length + plan.updates.length === 0, `${label}: ${updateText(plan)}`);
  }
}

export function aV3OverviewIsNotUpgradedAgain(): void {
  for (const tabs of [PHE_TABS, CSMOC_TABS]) {
    const plan = planOverviewUpgrade(v3Overview(), tabs);
    assert(plan.deletes.length + plan.updates.length === 0, `v3 overview: ${updateText(plan)}`);
  }
}

// ---- the runner's insert guard (F3.74, ADR 0088 Amendment 2, I6) -----------------------------

/**
 * I6 — a v3 Overview's compact-diagram insert that returns no row (a FORCE-RLS write dropped
 * outside the tenant bracket) throws, naming the runner and the insert. The fake copy is shaped so
 * every earlier step writes nothing: the v2 description, the v3 rects (no v1 rect, no v2 rect),
 * and an `sld` tab with no widget. The strip's move returns its row, so only the insert can fail.
 */
export async function anInsertThatReturnsNoRowThrowsNamingTheRunner(): Promise<void> {
  const overview = v3Overview();
  const rows = (withCounts: boolean) =>
    overview.map((widget) => ({
      id: widget.id,
      tab_key: widget.tabKey,
      widget_type: widget.widgetType,
      title: widget.title,
      grid_x: widget.gridX,
      grid_y: widget.gridY,
      grid_w: widget.gridW,
      grid_h: widget.gridH,
      ...(withCounts ? { config: widget.config, points: widget.points, sources: widget.sources } : {}),
    }));
  const written: string[] = [];
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("FROM bms.dashboards d")) return { rows: [{ id: "d1", description: SITE_LAYOUT_COPY_DESCRIPTION }], rowCount: 1 };
      if (sql.includes("AS points")) return { rows: rows(true), rowCount: overview.length };
      if (sql.includes("FROM bms.dashboard_widgets w")) return { rows: rows(false), rowCount: overview.length };
      if (sql.includes("FROM bms.dashboard_tabs")) {
        return { rows: [{ id: "tab-overview", tab_key: "overview" }, { id: "tab-sld", tab_key: "sld" }], rowCount: 2 };
      }
      written.push(sql.trim().match(/^(UPDATE|INSERT INTO|DELETE FROM)\s+\S+/)?.[0] ?? sql.trim().slice(0, 30));
      if (sql.includes("INSERT INTO bms.dashboard_widgets")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Parameters<typeof upgradeSeededSiteLayoutCopies>[0];
  let message = "no throw";
  try {
    await upgradeSeededSiteLayoutCopies(pool, "org-1", ["loc-1"], "site-layout-");
  } catch (error) {
    message = (error as Error).message;
  }
  assert(
    message.startsWith("upgradeSeededSiteLayoutCopies:") && message.includes("overview mimic insert returned no row") &&
      written.join(",") === "UPDATE bms.dashboard_widgets,INSERT INTO bms.dashboard_widgets",
    `${message} after ${written.join(",")}`,
  );
}

/** Widgets of other tabs are not the Overview's: the step reads the Overview only. */
export function theStepReadsTheOverviewOnly(): void {
  const sld = copyTab("sld", SMOC_STANDARD_V2_RECTS).map((widget) => ({ ...widget, points: 0, sources: 0, config: {} }));
  const plan = planOverviewUpgrade([...packedV2Overview(PHE_CARDS), ...sld], PHE_TABS);
  assert(updateText(plan) === V3_UPDATES && plan.deletes.length === 2, `with sld: ${updateText(plan)}`);
}
