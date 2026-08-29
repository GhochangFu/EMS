import type { WidgetType } from "@bms/shared";

import { WIDGET_CATALOG, type ValueTileConfig, type WidgetStatus, type WidgetTone } from "./widget-catalog";

/** `commonConfigFields` plus `value_tile`'s own `abbreviate` — every shape `formatWidgetValue` needs to read. */
export type WidgetValueFormat = {
  readonly unit?: string;
  readonly decimals?: number;
  readonly abbreviate?: boolean;
};

/**
 * Formats a reading for display. `null` — no bound point, or a stale/missing
 * sample — renders the same em dash `KpiTile` already uses for its own empty
 * state, never the literal string `"null"`.
 */
export function formatWidgetValue(value: number | null, format: WidgetValueFormat = {}): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const body = format.abbreviate
    ? abbreviateNumber(value, format.decimals)
    : format.decimals !== undefined
      ? value.toFixed(format.decimals)
      : String(value);
  return format.unit ? `${body} ${format.unit}` : body;
}

/**
 * `value_tile`'s `abbreviate` config key. Ignoring it overflows the card,
 * and the config would lie about what it does.
 *
 * `decimals` is threaded through and honoured below the 1000 threshold too
 * — an author sets `abbreviate` because the tile *sometimes* exceeds 1000,
 * so a sub-1000 reading must not fall back to an unrounded raw float and
 * overflow the card, which is the exact failure `abbreviate` exists to
 * prevent.
 */
function abbreviateNumber(value: number, decimals?: number): string {
  const abs = Math.abs(value);
  const [divisor, suffix]: [number, string] =
    abs >= 1_000_000_000
      ? [1_000_000_000, "B"]
      : abs >= 1_000_000
        ? [1_000_000, "M"]
        : abs >= 1_000
          ? [1_000, "k"]
          : [1, ""];
  if (divisor === 1) {
    return decimals !== undefined ? value.toFixed(decimals) : String(value);
  }
  const scaled = Math.round((value / divisor) * 100) / 100;
  return `${scaled}${suffix}`;
}

/**
 * A tank's fill percentage, clamped into `[0, 100]`. An unclamped value drives
 * the SVG fill rect outside the vessel outline.
 *
 * `fullScale` is `.positive()` on the contract side, so `0` cannot arrive
 * from stored config — this guard is for the *reading*, not the config: a
 * `null` reading (no data bound, or a value below zero from a miscalibrated
 * sensor) must not divide, and `null` out is what tells `TankLevelWidget` to
 * render its empty state rather than a fill of `NaN%`.
 */
export function tankFillPercent(value: number | null, fullScale: number): number | null {
  if (value === null || !Number.isFinite(fullScale) || fullScale <= 0) {
    return null;
  }
  const pct = (value / fullScale) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * `tank-level-widget.tsx`'s SVG vessel coordinate system. Owned here, not in
 * the component, so `tankFillGeometry` below is the only place that computes
 * an absolute `y`/`height` from a percentage — a single source rather than
 * two files agreeing on `FLOOR_Y`/`FILL_HEIGHT` by convention.
 */
export const TANK_VIEW_W = 100;
export const TANK_VIEW_H = 140;
export const TANK_WALL = 10;
export const TANK_FLOOR_Y = TANK_VIEW_H - TANK_WALL;
export const TANK_FILL_MAX_HEIGHT = TANK_FLOOR_Y - TANK_WALL;
export const TANK_FILL_WIDTH = TANK_VIEW_W - TANK_WALL * 2 - 4;

/**
 * The tank percentage is drawn at 2 decimals at most, whatever
 * `commonConfigFields.decimals` says (it permits 6).
 *
 * "100.000000%" is eleven characters and overflows a 100-unit vessel — the
 * same failure the `F3.1c` §4.6 browser pass found on "No data bound". It is
 * capped rather than shrunk to fit, and capped in the **label** as well as the
 * readout, so a screen reader and the screen say the same number: §7 calls
 * this widget "an SVG fill illustration plus a percentage", and a fill
 * illustration accurate to a millionth of a percent is precision the shape
 * cannot carry. An author who needs six decimals of a reading wants a
 * `value_tile`, which formats the reading itself rather than a fraction of
 * full scale.
 */
export const TANK_READOUT_MAX_DECIMALS = 2;

export type TankFillGeometry = {
  readonly y: number;
  readonly height: number;
  /** The full wording. Goes to the vessel's accessible name, where length costs nothing. */
  readonly label: string;
  /**
   * What is *drawn* inside the vessel, which is not always the label.
   *
   * The tank's `viewBox` is 100 units wide, so a 13-character sentence at the
   * 14px readout size overflows the vessel on both sides — found in the
   * `F3.1c` §4.6 browser pass, where "No data bound" rendered as
   * "lo data bound" clipped by the card. A percentage is at most six
   * characters and fits; the no-reading case draws the em dash `KpiTile`
   * already uses for the same condition, and the words stay in `label` for
   * anyone not looking at it.
   */
  readonly readout: string;
};

/**
 * The tank fill rect's position and its percentage label, as pure
 * arithmetic — moved out of `TankLevelWidget` because a sign error in
 * `y = floor - height` draws a full tank empty, plausibly, with no console
 * error and (until this moved here) no test that could catch it: the `.tsx`
 * is outside the coverage `include` and had no spec of its own (`F3.1c`
 * `Q1`).
 *
 * `decimals` is honoured on the percentage the way `commonConfigFields`
 * intends, e.g. "75.3%" rather than "75%" — `unit` is deliberately NOT
 * threaded through here: `tankLevelConfigSchema` inherits `unit` from
 * `commonConfigFields` uniformly across all four widget arms, but a fill
 * percentage is not a unit-bearing reading (`fullScale`'s unit, if any,
 * belongs to the *reading*, and "75.3% L" is not a thing) — §7 calls this
 * widget "an SVG fill illustration plus a percentage", not a formatted
 * value, so only precision applies here.
 */
export function tankFillGeometry(pct: number | null, decimals?: number): TankFillGeometry {
  if (pct === null) {
    return { y: TANK_FLOOR_Y, height: 0, label: "No data bound", readout: "—" };
  }
  const height = (pct / 100) * TANK_FILL_MAX_HEIGHT;
  const label = `${
    decimals !== undefined ? pct.toFixed(Math.min(decimals, TANK_READOUT_MAX_DECIMALS)) : Math.round(pct)
  }%`;
  return { y: TANK_FLOOR_Y - height, height, label, readout: label };
}

/**
 * Migration `0050` (~line 190): "`title` NULL means use the catalog label."
 * The empty string is treated the same way — `dashboardDtoSchema` deliberately
 * dropped `.min(1)`, so an empty-string title is a row the store can hold,
 * and rendering it verbatim would be a blank heading.
 */
export function widgetTitle(title: string | null, widgetType: WidgetType): string {
  return title && title.length > 0 ? title : WIDGET_CATALOG[widgetType].label;
}

/** `WidgetTone` has four values; `KpiTile`'s own `tone` prop has three. A missing arm renders a critical reading in the neutral colour. */
const WIDGET_TONE_TO_KPI_TONE: Readonly<Record<WidgetTone, "default" | "warning" | "critical">> = {
  ok: "default",
  info: "default",
  warning: "warning",
  critical: "critical",
};

export type KpiTileWidgetProps = {
  readonly label: string;
  readonly status: WidgetStatus;
  readonly value: string | null;
  readonly unit?: string;
  readonly tone: "default" | "warning" | "critical";
};

/**
 * Composes `ValueTileWidget`'s props for `<KpiTile ...>`. `tone` is not read
 * from `valueTileConfigSchema` — that config carries no tone field — so it is
 * a parameter with a neutral default; the mapping is tested exhaustively here
 * so it is correct the day a caller (alarm-derived state, `F3.28`) has a real
 * tone to pass.
 */
export function toKpiTileProps(params: {
  readonly title: string;
  readonly status: WidgetStatus;
  readonly primary: number | null;
  readonly config: ValueTileConfig;
  readonly tone?: WidgetTone;
}): KpiTileWidgetProps {
  const { title, status, primary, config, tone = "ok" } = params;
  return {
    label: title,
    status,
    // `unit` is passed to KpiTile separately below, which renders it in its
    // own span — not into `formatWidgetValue`'s `unit` option, or the tile
    // would read e.g. "7.1 kW kW".
    value: status === "ready" ? formatWidgetValue(primary, { decimals: config.decimals, abbreviate: config.abbreviate }) : null,
    unit: config.unit,
    tone: WIDGET_TONE_TO_KPI_TONE[tone],
  };
}
