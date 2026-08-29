import type { WidgetType } from "@bms/shared";

import type { KpiTileStatus } from "../components/kpi-tile";
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
    ? abbreviateNumber(value)
    : format.decimals !== undefined
      ? value.toFixed(format.decimals)
      : String(value);
  return format.unit ? `${body} ${format.unit}` : body;
}

/** `value_tile`'s `abbreviate` config key. Ignoring it overflows the card, and the config would lie about what it does. */
function abbreviateNumber(value: number): string {
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
    return String(value);
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
  readonly status: KpiTileStatus;
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
