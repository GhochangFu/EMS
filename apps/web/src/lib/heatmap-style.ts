import type { EChartsOption } from "echarts";

import { chartType } from "./design";
import { withAlpha, type Roles } from "./theme";

/**
 * The one look every day × hour grid shares (the wizard heatmap, the matrix and the energy
 * heatmap): each cell a separate rounded tile with a gap round it, colour in five stepped bands of
 * one hue, and a cell with no data drawn as a plain `well` tile rather than left as a hole.
 */

/** The five bands' alpha over the hue, lowest first; the top band is the hue itself. */
export const HEATMAP_BAND_ALPHAS = [0.15, 0.35, 0.55, 0.78, 1] as const;

/** Gap between tiles, in px: a border in the card's own colour. */
const TILE_GAP = 2;
const TILE_RADIUS = 3;

type Piece = { gt?: number; lte?: number; color: string; label: string };

/**
 * Five equal bands from `min` to `max`. The first is open below and the last open above, so a cell
 * outside the range (the energy heatmap's P95 top) still lands in the lowest or highest band.
 */
export function heatmapBands(min: number, max: number, hue: string, format: (v: number) => string): Piece[] {
  const top = max > min ? max : min + 1;
  const step = (top - min) / HEATMAP_BAND_ALPHAS.length;
  const last = HEATMAP_BAND_ALPHAS.length - 1;
  return HEATMAP_BAND_ALPHAS.map((alpha, i) => {
    const lo = min + step * i;
    const hi = min + step * (i + 1);
    const color = alpha === 1 ? hue : withAlpha(hue, alpha);
    if (i === 0) return { lte: hi, color, label: `≤ ${format(hi)}` };
    if (i === last) return { gt: lo, color, label: `> ${format(lo)}` };
    return { gt: lo, lte: hi, color, label: `${format(lo)} – ${format(hi)}` };
  });
}

/** The stepped legend for series 0, plus a hidden one that paints series 1 (the empty tiles). */
export function heatmapVisualMaps(
  min: number,
  max: number,
  hue: string,
  roles: Roles,
  format: (v: number) => string,
): NonNullable<EChartsOption["visualMap"]> {
  const pieces = heatmapBands(min, max, hue, format);
  return [
    {
      type: "piecewise",
      seriesIndex: 0,
      min,
      max: max > min ? max : min + 1,
      pieces,
      inRange: { color: pieces.map((p) => p.color) },
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { fontSize: chartType()["3xs"], color: roles["ink-muted"] },
    },
    // ECharts needs a visualMap on every heatmap series; this one only fixes the empty colour.
    { type: "piecewise", seriesIndex: 1, show: false, pieces: [{ value: 0, color: roles.well }] },
  ];
}

/** The tile border: the card's own colour, so it reads as a gap. */
export function heatmapTileStyle(roles: Roles): { borderColor: string; borderWidth: number; borderRadius: number } {
  return { borderColor: roles.surface, borderWidth: TILE_GAP, borderRadius: TILE_RADIUS };
}

/** Every `[x, y]` in a `columns × rows` grid that `filled` does not hold, as an empty tile. */
export function heatmapEmptyCells(
  columns: number,
  rows: number,
  filled: readonly (readonly [number, number, number])[],
): [number, number, number][] {
  const taken = new Set(filled.map(([x, y]) => `${x}|${y}`));
  const empty: [number, number, number][] = [];
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      if (!taken.has(`${x}|${y}`)) empty.push([x, y, 0]);
    }
  }
  return empty;
}

/** The second series: the empty tiles, drawn but silent (no tooltip, no hover). */
export function heatmapEmptySeries(
  empty: readonly (readonly [number, number, number])[],
  roles: Roles,
): { type: "heatmap"; data: [number, number, number][]; silent: true; itemStyle: ReturnType<typeof heatmapTileStyle> } {
  return { type: "heatmap", data: empty.map(([x, y, v]) => [x, y, v]), silent: true, itemStyle: heatmapTileStyle(roles) };
}
