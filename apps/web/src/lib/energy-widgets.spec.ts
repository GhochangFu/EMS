import { expect } from "vitest";

import { isKwOnly, stripTilePointKeys, visibleTiles, widgetPointKeys, type EnergyGridTile } from "./energy-widgets";

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 2, plan U5, D8, rulings Q2 and Q4) — which widgets a
 * no-energy site hides, and how the row closes the gap. Assertions live here; the sibling
 * `.test.ts` is the Vitest entry point (ADR 0014).
 */

function points(...keys: string[]): { pointKey: string }[] {
  return keys.map((pointKey) => ({ pointKey }));
}

function source(catalogKey: string, params: Record<string, string | number | boolean> = {}) {
  return { catalogKey, params };
}

/** W1 — the predicate over bound point keys (D8, Q2: `kw` exactly, every binding, not empty). */
export function runTheKwOnlyPredicate(): void {
  const cases: readonly (readonly [string, Parameters<typeof widgetPointKeys>[0], boolean])[] = [
    ["the stock Total load tile", { points: [], sources: [source("sustainability.total", { pointKey: "kw" })] }, true],
    ["a role tile with one kw point", { points: points("kw"), sources: [] }, true],
    ["two kw points", { points: points("kw", "kw"), sources: [] }, true],
    ["kw and kwh_today", { points: points("kw", "kwh_today"), sources: [] }, false],
    [
      "a kw source and an alarm count",
      { points: [], sources: [source("sustainability.total", { pointKey: "kw" }), source("alarms.active.count")] },
      false,
    ],
    ["no points and no sources (a mimic, a trend strip, a legend)", { points: [], sources: [] }, false],
    ["sustainability.total on kwh_today", { points: [], sources: [source("sustainability.total", { pointKey: "kwh_today" })] }, false],
    ["energy.cost.total", { points: [], sources: [source("energy.cost.total")] }, false],
    ["KW", { points: points("KW"), sources: [] }, false],
    ["it_kw", { points: points("it_kw"), sources: [] }, false],
    ["site_kw", { points: points("site_kw"), sources: [] }, false],
    ["kw_total", { points: points("kw_total"), sources: [] }, false],
    ["a non-string pointKey param", { points: [], sources: [source("sustainability.total", { pointKey: 1 })] }, false],
  ];
  for (const [what, widget, want] of cases) {
    expect({ what, got: isKwOnly(widgetPointKeys(widget)) }).toEqual({ what, got: want });
  }
}

/** W2 — an organization strip tile's keys are its sources' `pointKey`s (Q5). */
export function runTheStripTileKeys(): void {
  expect(isKwOnly(stripTilePointKeys({ sources: [{ pointKey: "kw" }] }))).toBe(true);
  expect(isKwOnly(stripTilePointKeys({ sources: [{ pointKey: "kwh_today" }] }))).toBe(false);
  expect(isKwOnly(stripTilePointKeys({ sources: [{ pointKey: null }] }))).toBe(false);
  expect(isKwOnly(stripTilePointKeys({ sources: [] }))).toBe(false);
}

interface Tile extends EnergyGridTile {
  id: string;
  kw: boolean;
}

function tile(id: string, gridX: number, gridY: number, gridW: number, gridH: number, kw = false): Tile {
  return { id, gridX, gridY, gridW, gridH, kw };
}

const hide = (t: Tile) => t.kw;

function layout(tiles: readonly Tile[]): string[] {
  return tiles.map((t) => `${t.id}@${t.gridX},${t.gridY}`);
}

/** W3 — Q4: inside a uniform row, the tiles to the right of a hidden one move left by its width. */
export function runTheGapClosesInAUniformRow(): void {
  const row = [tile("a", 0, 0, 3, 2), tile("b", 3, 0, 3, 2), tile("c", 6, 0, 3, 2, true), tile("d", 9, 0, 3, 2)];
  const third = visibleTiles(row, false, hide);
  expect({ tiles: layout(third.tiles), hidden: third.hidden }).toEqual({ tiles: ["a@0,0", "b@3,0", "d@6,0"], hidden: 1 });

  const first = [tile("a", 0, 0, 3, 2, true), tile("b", 3, 0, 3, 2), tile("c", 6, 0, 3, 2), tile("d", 9, 0, 3, 2)];
  expect(layout(visibleTiles(first, false, hide).tiles)).toEqual(["b@0,0", "c@3,0", "d@6,0"]);

  // Two hidden tiles to the left of a visible one: the shifts add up.
  const two = [tile("a", 0, 0, 3, 2, true), tile("b", 3, 0, 3, 2, true), tile("c", 6, 0, 3, 2), tile("d", 9, 0, 3, 2)];
  expect(layout(visibleTiles(two, false, hide).tiles)).toEqual(["c@0,0", "d@3,0"]);
}

/** W4 — a taller tile in the same rows makes the row non-uniform: nothing moves; other rows are untouched. */
export function runANonUniformRowIsLeftAsStored(): void {
  const mixed = [
    tile("a", 0, 0, 3, 2),
    tile("b", 3, 0, 3, 2, true),
    tile("c", 6, 0, 3, 2),
    tile("tall", 9, 0, 3, 4),
    tile("below", 0, 2, 3, 2),
    tile("below2", 3, 2, 3, 2),
  ];
  expect(layout(visibleTiles(mixed, false, hide).tiles)).toEqual(["a@0,0", "c@6,0", "tall@9,0", "below@0,2", "below2@3,2"]);

  const twoRows = [tile("a", 0, 0, 3, 2), tile("b", 3, 0, 3, 2, true), tile("c", 6, 0, 3, 2), tile("x", 6, 2, 3, 2)];
  expect(layout(visibleTiles(twoRows, false, hide).tiles)).toEqual(["a@0,0", "c@3,0", "x@6,2"]);

  // A staggered tile (same height, offset row) in the band makes it non-uniform: nothing moves.
  const staggered = [tile("a", 0, 0, 3, 2), tile("b", 3, 0, 3, 2, true), tile("c", 6, 0, 3, 2), tile("stag", 9, 1, 3, 2)];
  expect(layout(visibleTiles(staggered, false, hide).tiles)).toEqual(["a@0,0", "c@6,0", "stag@9,1"]);
}

/** W6 — the gap rule never moves a tile onto another one: a visible tile still covering the gap's columns keeps the row as stored. */
export function runTheGapNeverCreatesAnOverlap(): void {
  // A visible tile stacked in the hidden tile's columns (overlaps are allowed when stored).
  const stacked = [tile("a", 0, 0, 3, 2), tile("h", 3, 0, 3, 2, true), tile("s", 3, 0, 3, 2), tile("c", 6, 0, 3, 2)];
  expect(layout(visibleTiles(stacked, false, hide).tiles)).toEqual(["a@0,0", "s@3,0", "c@6,0"]);
  // A wide hidden tile partly under a visible one: no negative column, nothing moves.
  const under = [tile("h", 0, 0, 6, 2, true), tile("v", 3, 0, 3, 2), tile("c", 6, 0, 3, 2)];
  expect(layout(visibleTiles(under, false, hide).tiles)).toEqual(["v@3,0", "c@6,0"]);
}

/** W5 — energy shown, or nothing to hide: the same array comes back, nothing hidden. */
export function runNothingHiddenIsTheSameArray(): void {
  const row = [tile("a", 0, 0, 3, 2, true), tile("b", 3, 0, 3, 2)];
  const shown = visibleTiles(row, true, hide);
  expect(shown.tiles).toBe(row);
  expect(shown.hidden).toBe(0);
  const none = [tile("a", 0, 0, 3, 2), tile("b", 3, 0, 3, 2)];
  expect(visibleTiles(none, false, hide).tiles).toBe(none);
}
