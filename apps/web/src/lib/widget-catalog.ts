import type { ChartSeriesKind, DashboardWidgetSpec, WidgetType } from "@bms/shared";
import { WIDGET_POINT_CARDINALITY } from "@bms/shared";

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
 * What `DashboardWidget` renders while its data is not yet a value — the same
 * union `KpiTile` and `LoadTrendChart` already use as their own `status` prop,
 * declared once here so the compiler proves agreement at every spread site
 * rather than by a second declaration.
 */
export type WidgetStatus = "loading" | "error" | "empty" | "ready";

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

/** Hex, not a Tailwind class — `axisLine.lineStyle.color` and an SVG `fill` both need a colour value, not a class name. */
export const WIDGET_TONE_COLOR: Readonly<Record<WidgetTone, string>> = {
  ok: "#039855",
  info: "#0EA5E9",
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
  },
  tank_level: {
    label: "Tank level",
    iconPath: "M6 2h12v4H6V2Zm-1 6h14v14H5V8Zm2 12h10V10H7v10Z",
    defaultSize: { w: 3, h: 4 },
    points: WIDGET_POINT_CARDINALITY.tank_level,
  },
  value_tile: {
    label: "Value tile",
    iconPath: "M4 4h16v16H4V4Zm2 2v12h12V6H6Z",
    defaultSize: { w: 3, h: 2 },
    points: WIDGET_POINT_CARDINALITY.value_tile,
  },
  chart: {
    label: "Chart",
    iconPath: "M4 20V4h2v14h14v2H4Zm4-4V10h2v6H8Zm5 0V6h2v10h-2Zm5 0v-8h2v8h-2Z",
    defaultSize: { w: 6, h: 4 },
    points: WIDGET_POINT_CARDINALITY.chart,
  },
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
