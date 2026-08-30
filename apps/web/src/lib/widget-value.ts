import type { WidgetIcon, WidgetType } from "@bms/shared";

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

/** One computed change-over-time reading, ready to drop straight into `KpiTile`'s `hint` slot. */
export type WidgetDelta = {
  readonly direction: "up" | "down" | "flat";
  readonly text: string;
};

/**
 * `valueTileConfigSchema.compareToPrevious` (ADR 0048 decision 6): the delta
 * against the immediately preceding window of the same length. The wording
 * is pinned to the Nexus mock's own copy
 * (`docs/ion-exchange-nexus-dashboard-2026-08-29.html`, the KPI row) —
 * "vs yesterday" renders even for a non-24h `windowMinutes` today, which is
 * a copy gap for whoever ships a non-daily compare window, not something to
 * paper over here with vaguer wording the mock does not show.
 *
 * A `baseline` of `0` has no percentage — dividing by it renders `Infinity%`
 * or `NaN%`, not a delta — and either input missing means there is nothing
 * to compare, not a delta of zero. All three return `null`.
 *
 * "Flat" is decided on the *rounded* magnitude, not on exact equality: a
 * change that rounds to `0.0%` must not point an up or down arrow at a
 * direction the printed number does not support. The flat case draws a
 * third, neutral arrow instead of picking one of the other two, so "no
 * material change" is not mistaken for "no data" — the condition an absent
 * `hint` already means.
 */
export function formatDelta(current: number | null, baseline: number | null): WidgetDelta | null {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline)) {
    return null;
  }
  if (baseline === 0) {
    return null;
  }
  const pct = ((current - baseline) / baseline) * 100;
  const magnitude = Math.abs(pct).toFixed(1);
  if (magnitude === "0.0") {
    return { direction: "flat", text: `→ ${magnitude}% vs yesterday` };
  }
  return {
    direction: pct > 0 ? "up" : "down",
    text: `${pct > 0 ? "↑" : "↓"} ${magnitude}% vs yesterday`,
  };
}

export type KpiTileWidgetProps = {
  readonly label: string;
  readonly status: WidgetStatus;
  readonly value: string | null;
  readonly unit?: string;
  /**
   * One line under the value. `toKpiTileProps` fills it from at most one
   * source — the computed delta or `config.hint`, never both — per the one
   * slot `valueTileConfigSchema.hint`'s own docblock rules.
   */
  readonly hint?: string;
  readonly tone: "default" | "warning" | "critical";
  /**
   * A name, not an element — this file is `.ts` and cannot hold JSX.
   * `ValueTileWidget`'s `.tsx` resolves the name to the actual icon.
   */
  readonly icon?: WidgetIcon;
};

/**
 * Composes `ValueTileWidget`'s props for `<KpiTile ...>`.
 *
 * `tone`: a caller-supplied `tone` wins over `config.tone` — `F3.28`'s
 * alarm-derived tone reflects a *live* condition (an active alarm), which
 * outranks the tile's own static, author-set default. Neither present falls
 * back to `"ok"`, same as before this config field existed.
 *
 * `hint`: the delta computed from `compareValue` wins the slot over
 * `config.hint` whenever `config.compareToPrevious` is set *and* the delta
 * is computable (see `formatDelta`); otherwise `config.hint` renders, and if
 * neither applies `hint` is left `undefined`. `compareValue` is a parameter,
 * not a fetch — this function stays pure arithmetic on values its caller
 * already holds.
 *
 * `icon`: carried through by name only — see `KpiTileWidgetProps.icon`.
 */
export function toKpiTileProps(params: {
  readonly title: string;
  readonly status: WidgetStatus;
  readonly primary: number | null;
  readonly config: ValueTileConfig;
  readonly tone?: WidgetTone;
  readonly compareValue?: number | null;
}): KpiTileWidgetProps {
  const { title, status, primary, config, tone, compareValue = null } = params;
  const ready = status === "ready";
  // **Gated on `ready` for the same reason `value` is.** TanStack Query keeps
  // the previous `data` through a refetch error, so a widget can hold a stale
  // non-null `primary` while its status is `"error"`. Ungated, the tile would
  // then read "Could not load" with a confident "↓ 6.8% vs yesterday" under it —
  // a number the operator can act on, above a line saying the read failed.
  const delta = ready && config.compareToPrevious ? formatDelta(primary, compareValue) : null;
  return {
    label: title,
    status,
    // `unit` is passed to KpiTile separately below, which renders it in its
    // own span — not into `formatWidgetValue`'s `unit` option, or the tile
    // would read e.g. "7.1 kW kW".
    value: ready ? formatWidgetValue(primary, { decimals: config.decimals, abbreviate: config.abbreviate }) : null,
    unit: config.unit,
    hint: delta ? delta.text : config.hint,
    tone: WIDGET_TONE_TO_KPI_TONE[tone ?? config.tone ?? "ok"],
    icon: config.icon,
  };
}
