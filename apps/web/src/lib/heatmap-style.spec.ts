import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { HEATMAP_BAND_ALPHAS, heatmapBands, heatmapEmptyCells, heatmapTileStyle, heatmapVisualMaps } from "./heatmap-style";
import { resolveRoles } from "./theme";

/** The shared heatmap look — stepped bands, gapped tiles, empty hours as tiles. Entry: `heatmap-style.test.ts`. */

const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));
const fmt = (v: number): string => v.toFixed(0);

export function fiveBandsCoverEveryValueAndEndOnTheHue(): void {
  const bands = heatmapBands(0, 100, roles["series-1"], fmt);
  expect(bands).toHaveLength(HEATMAP_BAND_ALPHAS.length);
  expect(bands[0], "the lowest band is open below").toMatchObject({ lte: 20 });
  expect(bands[0]?.gt).toBeUndefined();
  expect(bands[2]).toMatchObject({ gt: 40, lte: 60, label: "40 – 60" });
  expect(bands.at(-1), "the top band is open above, so a cell past P95 saturates").toMatchObject({ gt: 80 });
  expect(bands.at(-1)?.lte).toBeUndefined();
  expect(bands.at(-1)?.color).toBe(roles["series-1"]);
}

export function aFlatRangeStillHasFiveBands(): void {
  const bands = heatmapBands(5, 5, roles["series-1"], fmt);
  expect(bands).toHaveLength(5);
  expect(bands[0]?.lte).toBeGreaterThan(5);
}

export function theLegendIsSteppedAndTheEmptyTilesUseWell(): void {
  const maps = heatmapVisualMaps(0, 10, roles["series-1"], roles, fmt) as {
    type: string;
    seriesIndex: number;
    show?: boolean;
    pieces: { color: string }[];
  }[];
  expect(maps[0]).toMatchObject({ type: "piecewise", seriesIndex: 0 });
  expect(maps[1]).toMatchObject({ seriesIndex: 1, show: false });
  expect(maps[1]?.pieces[0]?.color).toBe(roles.well);
}

export function tilesHaveAGapInTheCardColour(): void {
  expect(heatmapTileStyle(roles)).toMatchObject({ borderColor: roles.surface });
  expect(heatmapTileStyle(roles).borderWidth).toBeGreaterThan(0);
}

export function emptyCellsAreEveryGridSlotWithoutAValue(): void {
  const empty = heatmapEmptyCells(2, 3, [
    [0, 0, 4],
    [1, 2, 9],
  ]);
  expect(empty).toEqual([
    [0, 1, 0],
    [0, 2, 0],
    [1, 0, 0],
    [1, 1, 0],
  ]);
}
