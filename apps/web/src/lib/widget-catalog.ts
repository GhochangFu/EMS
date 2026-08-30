import type { ChartSeriesKind, DashboardWidgetSpec, WidgetIcon, WidgetType } from "@bms/shared";
import { WIDGET_POINT_CARDINALITY, WIDGET_SOURCE_CARDINALITY } from "@bms/shared";

import type { KpiTileStatus } from "../components/kpi-tile";

/**
 * `F3.1c` — the dashboard widget catalog (ADR 0047, Amendment 2 §1).
 *
 * **The per-arm config types are derived, never restated.** `apps/web` carries
 * no `zod` and must not gain one — pnpm is strict, so `z.infer<typeof …>`
 * would not resolve here, and adding `zod` is a §9.4 dependency gate this row
 * cannot open. `Extract` over the already-exported `DashboardWidgetSpec`
 * union is the only encoding available, and it is declared once, here.
 */
export type RadialGaugeConfig = Extract<DashboardWidgetSpec, { widgetType: "radial_gauge" }>["config"];
export type TankLevelConfig = Extract<DashboardWidgetSpec, { widgetType: "tank_level" }>["config"];
export type ValueTileConfig = Extract<DashboardWidgetSpec, { widgetType: "value_tile" }>["config"];
export type ChartConfig = Extract<DashboardWidgetSpec, { widgetType: "chart" }>["config"];

/**
 * The presentation tone of a gauge threshold band or a tank's fill —
 * `widgetToneSchema` in `packages/shared/src/contracts/dashboard-builder.ts`,
 * taken by `Extract` rather than restated. `StatusPill` uses the same four
 * values plus a fifth (`offline`) that no widget config carries.
 */
export type WidgetTone = NonNullable<
  Extract<DashboardWidgetSpec, { widgetType: "tank_level" }>["config"]["fillTone"]
>;

/**
 * What `DashboardWidget` renders while its data is not yet a value.
 * §4.8: a vocabulary is declared once — this **is** `KpiTileStatus`
 * (`kpi-tile.tsx`), not a second four-member union that happens to read the
 * same, so the compiler proves agreement at every spread site rather than
 * three independent declarations drifting apart (`WidgetData`'s `status`
 * below derives from this rather than restating it a third time).
 * `LoadTrendChart` uses the same shape as its own `status` prop too.
 */
export type WidgetStatus = KpiTileStatus;

/** One bound series' worth of samples, ordered by time, as a widget receives it. */
export type WidgetSeriesPoint = { readonly t: string; readonly v: number | null };

/**
 * One series a `chart` widget draws. `name` comes from the point binding a
 * caller resolved (`F3.1d`/`F3.1b`'s job, not this row's); `sortOrder` is the
 * bound point's `dashboard_widget_points.sort_order`, carried through so the
 * legend order — and therefore its colours — stays stable between reads.
 *
 * Not a `packages/shared` export: this describes what a renderer needs to
 * draw, not what an endpoint returns. `F3.1d` maps `F3.1b`'s response into it.
 */
export type WidgetSeries = {
  readonly name: string;
  readonly sortOrder: number;
  readonly points: readonly WidgetSeriesPoint[];
};

/**
 * Hex, not a Tailwind class — `axisLine.lineStyle.color` and an SVG `fill`
 * both need a colour value, not a class name. Sourced from `TRINETRA.html:12`
 * (`--sc`, `--in`, `--wn`, `--cr`), matching §5's palette rule and the same
 * four hexes already in use for this semantic — `energy-top-bar-chart.tsx:17`
 * and `crac-schematic.tsx:354,361` for `info`, `crac-schematic.tsx:17-19` for
 * the other three.
 */
export const WIDGET_TONE_COLOR: Readonly<Record<WidgetTone, string>> = {
  ok: "#039855",
  info: "#1570EF",
  warning: "#DC6803",
  critical: "#D92D20",
};

type WidgetCatalogEntry = {
  readonly label: string;
  /** An SVG path `d` string, not JSX — this file is `.ts` and cannot hold a component, and every icon in this codebase is already inline SVG. */
  readonly iconPath: string;
  readonly defaultSize: { readonly w: number; readonly h: number };
  /** Imported from `@bms/shared`, never restated — ADR 0047 Amendment 2 §1: the write path and the renderer must agree about which dashboards are legal, and a rule enforced by only one of two surfaces is not enforced. */
  readonly points: { readonly min: number; readonly max: number };
  /** `F3.35` Stage C. Imported for the same reason as `points`: the builder must refuse a binding the write path would refuse, and only the tile takes a catalog source today. */
  readonly sources: { readonly min: number; readonly max: number };
};

/**
 * The four widget types, closed (ADR 0047 decision 2). Label, icon and
 * default size are presentation and belong here; `points` is a validation
 * rule and is imported rather than restated (Amendment 2 §1).
 */
export const WIDGET_CATALOG: Readonly<Record<WidgetType, WidgetCatalogEntry>> = {
  radial_gauge: {
    label: "Radial gauge",
    iconPath: "M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2Z",
    defaultSize: { w: 3, h: 4 },
    points: WIDGET_POINT_CARDINALITY.radial_gauge,
    sources: WIDGET_SOURCE_CARDINALITY.radial_gauge,
  },
  tank_level: {
    label: "Tank level",
    iconPath: "M6 2h12v4H6V2Zm-1 6h14v14H5V8Zm2 12h10V10H7v10Z",
    defaultSize: { w: 3, h: 4 },
    points: WIDGET_POINT_CARDINALITY.tank_level,
    sources: WIDGET_SOURCE_CARDINALITY.tank_level,
  },
  value_tile: {
    label: "Value tile",
    iconPath: "M4 4h16v16H4V4Zm2 2v12h12V6H6Z",
    defaultSize: { w: 3, h: 2 },
    points: WIDGET_POINT_CARDINALITY.value_tile,
    sources: WIDGET_SOURCE_CARDINALITY.value_tile,
  },
  chart: {
    label: "Chart",
    iconPath: "M4 20V4h2v14h14v2H4Zm4-4V10h2v6H8Zm5 0V6h2v10h-2Zm5 0v-8h2v8h-2Z",
    defaultSize: { w: 6, h: 4 },
    points: WIDGET_POINT_CARDINALITY.chart,
    sources: WIDGET_SOURCE_CARDINALITY.chart,
  },
};

/**
 * The `value_tile` icon vocabulary (`widgetIconSchema`, ADR 0048 decision 6),
 * mapped to an SVG path `d` string — see `WidgetCatalogEntry.iconPath`'s
 * comment above for why a path string and not JSX.
 *
 * The `Record` over the imported `WidgetIcon` type is load-bearing: a
 * seventh enum member with no entry here is a compile error at this
 * declaration, not a blank square discovered on a running dashboard.
 * `tests/f3.35-tile-icon-vocabulary.test.ts` holds the reverse direction —
 * an entry here with no matching enum member — which the compiler cannot see
 * because an extra object key is not a type error.
 */
export const WIDGET_ICON_PATH: Readonly<Record<WidgetIcon, string>> = {
  alert: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clipboard:
    "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  drop: "M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z",
  recycle:
    "M12 6V2L7 7l5 5V8c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 14c0-4.42-3.58-8-8-8zm-6 8c0-1.01.25-1.97.7-2.8L5.24 9.74A7.93 7.93 0 0 0 4 14c0 4.42 3.58 8 8 8v4l5-5-5-5v4c-3.31 0-6-2.69-6-6z",
  gauge:
    "M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z",
};

/**
 * `chart`'s series kinds, mapped to plain labels and to the ECharts shape
 * that draws them (ADR 0047 decision 4, Amendment 2 §4). **These four labels
 * are ruled by the owner — do not invent others.**
 *
 * `area` is **not** an ECharts series type: it is `type: "line"` plus
 * `areaStyle`. This is the one mapping a reader will "simplify" to
 * `type: "area"`, which does not exist — which is exactly why it lives in one
 * place rather than being restated at each call site.
 */
export const CHART_SERIES: Readonly<Record<ChartSeriesKind, { readonly label: string; readonly type: "line" | "bar" | "scatter"; readonly area: boolean }>> = {
  line: { label: "Trend", type: "line", area: false },
  area: { label: "Trend (filled)", type: "line", area: true },
  bar: { label: "Comparison bars", type: "bar", area: false },
  scatter: { label: "Scatter", type: "scatter", area: false },
};
