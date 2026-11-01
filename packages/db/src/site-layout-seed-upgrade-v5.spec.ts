import type { SectionTemplateContent } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  planTrendStripV5Upgrade,
  type TrendStripV5Plan,
  type V5CopyTab,
  type V5CopyWidget,
} from "./site-layout-seed-upgrade-v5";
import { canonicalJson, type GridRect, smocStandardV4Content } from "./site-layout-stock-history";

/**
 * `F4.305` (ADR 0108 Amendment 3 items 5 and 8) — the v5 step of the seed upgrade chain: one
 * `trend_strip` under the top tile row of every tab, found by geometry and widget type, and every
 * widget below it moved down by the strip's height. Assertions live here;
 * `site-layout-seed-upgrade-v5.test.ts` is the Vitest entry point (ADR 0014). The database half
 * (the once-per-copy stamp) is `tests/f4.305-site-layout-v5-upgrade.integration.test.ts`.
 *
 * The fixtures are written with literal rects, never built by the function under test.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function widget(id: string, tabKey: string, widgetType: string, rect: [number, number, number, number], title: string | null = id): V5CopyWidget {
  const [gridX, gridY, gridW, gridH] = rect;
  return { id, tabKey, widgetType, title, gridX, gridY, gridW, gridH };
}

const rectText = (rect: GridRect): string => `${rect.gridX},${rect.gridY},${rect.gridW},${rect.gridH}`;
const moveText = (plan: TrendStripV5Plan): string =>
  plan.moves
    .map((move) => `${move.id}:${rectText(move.from)}>${rectText(move.to)}`)
    .sort()
    .join(";");
const insertText = (plan: TrendStripV5Plan): string =>
  plan.inserts
    .map((insert) => `${insert.tabKey}|${insert.widgetType}|${insert.title}@${rectText(insert.to)}${canonicalJson(insert.config)}`)
    .sort()
    .join(";");

/** The stock v4 Overview as a copy holds it (literal rects, the CSMOC copy before `F4.305`). */
function v4Overview(): V5CopyWidget[] {
  return [
    widget("t1", "overview", "value_tile", [0, 0, 3, 2]),
    widget("t2", "overview", "value_tile", [3, 0, 3, 2]),
    widget("t3", "overview", "value_tile", [6, 0, 3, 2]),
    widget("t4", "overview", "value_tile", [9, 0, 3, 2]),
    widget("rail", "overview", "active_alarms_rail", [0, 2, 8, 7]),
    widget("list", "overview", "critical_systems_list", [8, 2, 4, 7]),
    widget("mimic", "overview", "mimic", [0, 9, 6, 2], null),
    widget("strip", "overview", "asset_class_strip", [6, 9, 6, 2], null),
    widget("legend", "overview", "state_legend", [0, 11, 12, 1], null),
  ];
}

/** The stock v4 electrical tab with one kept role tile, as CSMOC's copy holds it. */
function v4Sld(): V5CopyWidget[] {
  return [
    widget("s-tile", "sld", "value_tile", [0, 0, 3, 2]),
    widget("s-mimic", "sld", "mimic", [0, 2, 12, 7], null),
    widget("s-breakers", "sld", "breaker_table", [0, 9, 12, 5]),
    widget("s-rail", "sld", "active_alarms_rail", [0, 14, 6, 5]),
    widget("s-table", "sld", "table", [6, 14, 6, 5]),
  ];
}

const OVERVIEW_TAB: V5CopyTab = { key: "overview", assetGroupId: null };
const SLD_TAB: V5CopyTab = { key: "sld", assetGroupId: "group-sld" };

/** Whether any two widgets of one tab overlap, after the plan is applied. */
function overlapsAfter(widgets: readonly V5CopyWidget[], plan: TrendStripV5Plan): string[] {
  const moved = new Map(plan.moves.map((move) => [move.id, move.to]));
  const placed = [
    ...widgets.map((w) => ({ tabKey: w.tabKey, name: w.id, rect: moved.get(w.id) ?? w })),
    ...plan.inserts.map((insert) => ({ tabKey: insert.tabKey, name: `${insert.tabKey}-strip`, rect: insert.to })),
  ];
  const clashes: string[] = [];
  for (const [i, a] of placed.entries()) {
    for (const b of placed.slice(i + 1)) {
      if (a.tabKey !== b.tabKey) continue;
      const apart =
        a.rect.gridX + a.rect.gridW <= b.rect.gridX ||
        b.rect.gridX + b.rect.gridW <= a.rect.gridX ||
        a.rect.gridY + a.rect.gridH <= b.rect.gridY ||
        b.rect.gridY + b.rect.gridH <= a.rect.gridY;
      if (!apart) clashes.push(`${a.name}/${b.name}`);
    }
  }
  return clashes;
}

/** V5-1 — the stock v4 Overview: the strip at `0,2`, the whole site, and the body down by 4. */
export function aStockV4OverviewGainsOneStripUnderItsTiles(): void {
  const plan = planTrendStripV5Upgrade(v4Overview(), [OVERVIEW_TAB]);
  const inserts = insertText(plan);
  const moves = moveText(plan);
  assert(
    inserts === 'overview|trend_strip|Trends@0,2,12,4{"defaultRange":"24h"}' &&
      moves ===
        "legend:0,11,12,1>0,15,12,1;list:8,2,4,7>8,6,4,7;mimic:0,9,6,2>0,13,6,2;" +
          "rail:0,2,8,7>0,6,8,7;strip:6,9,6,2>6,13,6,2",
    `inserts ${inserts}; moves ${moves}`,
  );
}

/** V5-2 — a tab bound to a group names its own tab key, so the strip reads that group. */
export function aGroupTabStripNamesItsOwnTab(): void {
  const plan = planTrendStripV5Upgrade(v4Sld(), [SLD_TAB]);
  const inserts = insertText(plan);
  const moves = moveText(plan);
  assert(
    inserts === 'sld|trend_strip|Trends@0,2,12,4{"defaultRange":"24h","tabKey":"sld"}' &&
      moves ===
        "s-breakers:0,9,12,5>0,13,12,5;s-mimic:0,2,12,7>0,6,12,7;s-rail:0,14,6,5>0,18,6,5;s-table:6,14,6,5>6,18,6,5",
    `inserts ${inserts}; moves ${moves}`,
  );
}

/**
 * V5-3 — a tab that already holds a `trend_strip`, anywhere, is left whole; another tab in the
 * same copy still gains its strip (the adjacent positive case).
 * Mutation: drop the skip → the Overview gains a second strip → red.
 */
export function aTabHoldingAStripIsLeftWhole(): void {
  const overview = [...v4Overview(), widget("own", "overview", "trend_strip", [0, 12, 12, 4], "My trends")];
  const plan = planTrendStripV5Upgrade([...overview, ...v4Sld()], [OVERVIEW_TAB, SLD_TAB]);
  const touched = [...plan.moves.map((move) => move.id), ...plan.inserts.map((insert) => insert.tabKey)];
  assert(
    !touched.some((name) => name === "overview" || overview.some((w) => w.id === name)) &&
      plan.inserts.length === 1 &&
      plan.inserts[0]?.tabKey === "sld",
    `touched ${touched.join(",")}`,
  );
}

/** V5-4 — a tab with no value tile gets the strip at the top, and everything moves down by 4. */
export function aTabWithNoTileGetsTheStripAtTheTop(): void {
  const water = [
    widget("w-mimic", "water", "mimic", [0, 0, 12, 7], null),
    widget("w-rail", "water", "active_alarms_rail", [0, 7, 6, 5]),
    widget("w-table", "water", "table", [6, 7, 6, 5]),
  ];
  const plan = planTrendStripV5Upgrade(water, [{ key: "water", assetGroupId: "group-water" }]);
  const inserts = insertText(plan);
  const moves = moveText(plan);
  assert(
    inserts === 'water|trend_strip|Trends@0,0,12,4{"defaultRange":"24h","tabKey":"water"}' &&
      moves === "w-mimic:0,0,12,7>0,4,12,7;w-rail:0,7,6,5>0,11,6,5;w-table:6,7,6,5>6,11,6,5",
    `inserts ${inserts}; moves ${moves}`,
  );
}

/**
 * V5-5 — an administrator moved one tile down a row (and the body with it): the tile crosses the
 * top row's line, so the cut is its bottom, `3`, and the moved tile stays above the strip.
 */
export function aMovedTileRaisesTheCut(): void {
  const edited = v4Overview().map((w) =>
    w.id === "t3" ? { ...w, gridY: 1 } : w.gridY >= 2 ? { ...w, gridY: w.gridY + 1 } : w,
  );
  const plan = planTrendStripV5Upgrade(edited, [OVERVIEW_TAB]);
  const insert = plan.inserts[0];
  const moved = plan.moves.map((move) => move.id).sort().join(",");
  assert(
    plan.inserts.length === 1 && insert !== undefined && rectText(insert.to) === "0,3,12,4" && moved === "legend,list,mimic,rail,strip",
    `insert ${insert && rectText(insert.to)}; moved ${moved}`,
  );
}

/**
 * V5-6 — a widget that is not a tile crosses the tile row's line (`6,1,6,2` across `y2`): the cut
 * rises to its bottom, `3`, so the strip overlaps nothing.
 * Mutation: drop the crossing loop → the strip lands at `y2`, across the panel → red (the overlap
 * check, as well as the rect).
 */
export function aCrossingWidgetRaisesTheCut(): void {
  const tab = [
    widget("a", "hvac", "value_tile", [0, 0, 3, 2]),
    widget("b", "hvac", "value_tile", [3, 0, 3, 2]),
    widget("panel", "hvac", "critical_systems_list", [6, 1, 6, 2]),
    widget("rail", "hvac", "active_alarms_rail", [0, 3, 6, 5]),
  ];
  const plan = planTrendStripV5Upgrade(tab, [{ key: "hvac", assetGroupId: "group-hvac" }]);
  const insert = plan.inserts[0];
  const clashes = overlapsAfter(tab, plan);
  assert(
    insert !== undefined && rectText(insert.to) === "0,3,12,4" && moveText(plan) === "rail:0,3,6,5>0,7,6,5" && clashes.length === 0,
    `insert ${insert && rectText(insert.to)}; moves ${moveText(plan)}; clashes ${clashes.join(",")}`,
  );
}

/** V5-6b — a chain of crossings: each raise of the cut is checked again. */
export function aChainOfCrossingsRaisesTheCutToTheLast(): void {
  const tab = [
    widget("a", "env", "value_tile", [0, 0, 3, 2]),
    widget("p", "env", "table", [3, 1, 3, 3]),
    widget("q", "env", "table", [6, 3, 3, 2]),
    widget("r", "env", "table", [0, 6, 12, 2]),
  ];
  const plan = planTrendStripV5Upgrade(tab, [{ key: "env", assetGroupId: null }]);
  const insert = plan.inserts[0];
  assert(
    insert !== undefined && rectText(insert.to) === "0,5,12,4" && moveText(plan) === "r:0,6,12,2>0,10,12,2" &&
      overlapsAfter(tab, plan).length === 0,
    `insert ${insert && rectText(insert.to)}; moves ${moveText(plan)}`,
  );
}

/** Every fixture the cases above use, with its tabs. */
function fixtures(): { name: string; widgets: V5CopyWidget[]; tabs: V5CopyTab[] }[] {
  return [
    { name: "v4 overview", widgets: v4Overview(), tabs: [OVERVIEW_TAB] },
    { name: "v4 sld", widgets: v4Sld(), tabs: [SLD_TAB] },
    {
      name: "moved tile",
      widgets: v4Overview().map((w) => (w.id === "t3" ? { ...w, gridY: 1 } : w.gridY >= 2 ? { ...w, gridY: w.gridY + 1 } : w)),
      tabs: [OVERVIEW_TAB],
    },
    {
      name: "crossing",
      widgets: [
        widget("a", "hvac", "value_tile", [0, 0, 3, 2]),
        widget("panel", "hvac", "critical_systems_list", [6, 1, 6, 2]),
        widget("rail", "hvac", "active_alarms_rail", [0, 3, 6, 5]),
      ],
      tabs: [{ key: "hvac", assetGroupId: "g" }],
    },
    {
      name: "tiles lower down",
      widgets: [
        widget("m", "ups", "mimic", [0, 0, 12, 3], null),
        widget("x", "ups", "value_tile", [0, 3, 3, 2]),
        widget("y", "ups", "value_tile", [3, 4, 3, 2]),
        widget("z", "ups", "table", [6, 3, 6, 6]),
      ],
      tabs: [{ key: "ups", assetGroupId: "g" }],
    },
    { name: "two tabs", widgets: [...v4Overview(), ...v4Sld()], tabs: [OVERVIEW_TAB, SLD_TAB] },
  ];
}

/** V5-7 — the property: on every fixture, the planned tab overlaps nothing. */
export function theStripNeverOverlaps(): void {
  const clashes = fixtures().flatMap((fixture) =>
    overlapsAfter(fixture.widgets, planTrendStripV5Upgrade(fixture.widgets, fixture.tabs)).map((c) => `${fixture.name}: ${c}`),
  );
  assert(clashes.length === 0, clashes.join("; "));
}

/** V5-7b — the moves are exactly 4 rows down, and only of widgets at or below the strip's top. */
export function everyMoveIsTheStripsHeightDown(): void {
  const wrong = fixtures().flatMap((fixture) => {
    const plan = planTrendStripV5Upgrade(fixture.widgets, fixture.tabs);
    const cutOf = new Map(plan.inserts.map((insert) => [insert.tabKey, insert.to.gridY]));
    const moved = new Map(plan.moves.map((move) => [move.id, move]));
    return fixture.widgets.flatMap((w) => {
      const move = moved.get(w.id);
      const below = w.gridY >= (cutOf.get(w.tabKey) ?? Infinity);
      const right =
        below === (move !== undefined) &&
        (move === undefined ||
          (move.to.gridY === w.gridY + 4 && move.to.gridX === w.gridX && move.to.gridW === w.gridW && move.to.gridH === w.gridH &&
            rectText(move.from) === rectText(w)));
      return right ? [] : [`${fixture.name}: ${w.id}`];
    });
  });
  assert(wrong.length === 0, wrong.join("; "));
}

/** V5-8 — a copy with no tab plans nothing, also when it holds widgets. */
export function aCopyWithNoTabPlansNothing(): void {
  const plan = planTrendStripV5Upgrade(v4Overview(), []);
  assert(plan.moves.length === 0 && plan.inserts.length === 0, `${moveText(plan)} / ${insertText(plan)}`);
}

/** V5-8b — an empty tab still gets its strip, at the top. */
export function anEmptyTabGetsTheStripAtTheTop(): void {
  const plan = planTrendStripV5Upgrade([], [{ key: "env", assetGroupId: "group-env" }]);
  assert(
    insertText(plan) === 'env|trend_strip|Trends@0,0,12,4{"defaultRange":"24h","tabKey":"env"}' && plan.moves.length === 0,
    insertText(plan),
  );
}

/** V5-9 — the plan does not depend on the order the rows were read in. */
export function thePlanDoesNotDependOnTheRowOrder(): void {
  const mismatches = fixtures().flatMap((fixture) => {
    const forward = planTrendStripV5Upgrade(fixture.widgets, fixture.tabs);
    const reversed = planTrendStripV5Upgrade([...fixture.widgets].reverse(), [...fixture.tabs].reverse());
    return JSON.stringify(forward) === JSON.stringify(reversed) ? [] : [fixture.name];
  });
  assert(mismatches.length === 0, `differs for ${mismatches.join(", ")}`);
}

/**
 * V5-10 — the step on the frozen stock v4 lands every tab on stock v5: the same rects and configs
 * as the live entry, tab by tab (the Overview the whole site, every other tab its own group). This
 * is what makes an upgraded copy equal a fresh one.
 */
export function theStepOnStockV4GivesStockV5(): void {
  const v4: SectionTemplateContent = smocStandardV4Content();
  const v5 = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;
  const wrong: string[] = [];
  for (const tab of v4.tabs) {
    const widgets = tab.widgets.map((w) => widget(w.key, tab.key, w.widgetType, [w.gridX, w.gridY, w.gridW, w.gridH], w.title));
    const plan = planTrendStripV5Upgrade(widgets, [{ key: tab.key, assetGroupId: tab.key === "overview" ? null : `group-${tab.key}` }]);
    const moved = new Map(plan.moves.map((move) => [move.id, move.to]));
    const after = [
      ...widgets.map((w) => `${w.widgetType}|${w.title ?? ""}@${rectText(moved.get(w.id) ?? w)}`),
      ...plan.inserts.map((insert) => `${insert.widgetType}|${insert.title ?? ""}@${rectText(insert.to)}${canonicalJson(insert.config)}`),
    ].sort();
    const live = v5.tabs.find((candidate) => candidate.key === tab.key);
    const expected = (live?.widgets ?? [])
      .map(
        (w) =>
          `${w.widgetType}|${w.title ?? ""}@${rectText(w)}${w.widgetType === "trend_strip" ? canonicalJson(w.config) : ""}`,
      )
      .sort();
    if (JSON.stringify(after) !== JSON.stringify(expected)) wrong.push(`${tab.key}: ${after.join(";")} vs ${expected.join(";")}`);
  }
  assert(wrong.length === 0 && v4.tabs.length === v5.tabs.length, wrong.join(" | "));
}
