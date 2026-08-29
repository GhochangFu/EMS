import type { DashboardWidgetDto } from "@bms/shared";

import type { WidgetSeries, WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { ChartWidget } from "./chart-widget";
import { RadialGaugeWidget } from "./radial-gauge-widget";
import { TankLevelWidget } from "./tank-level-widget";
import { ValueTileWidget } from "./value-tile-widget";

/**
 * What a renderer needs to draw — **not** a `packages/shared` export and must
 * not become one. It describes the shape this row's dispatcher consumes,
 * not what an endpoint returns; `F3.1d` maps `F3.1b`'s response into it.
 * This is the seam `F3.1d` inherits, so it is defined deliberately rather
 * than left implicit.
 *
 * `status` derives from `WidgetStatus` (§4.8: a vocabulary is declared
 * once) rather than restating its four members a third time — `WidgetStatus`
 * itself is `KpiTileStatus`, not a fourth independent copy.
 */
export type WidgetData =
  | { status: Exclude<WidgetStatus, "ready"> }
  | { status: Extract<WidgetStatus, "ready">; primary: number | null; series: readonly WidgetSeries[] };

type DashboardWidgetProps = {
  widget: DashboardWidgetDto;
  data: WidgetData;
  /** Injected reference time, defaulted to the clock read here at render — never inside a pure builder (see `widget-echarts-option.ts`). */
  now?: number;
};

const NO_SERIES: readonly WidgetSeries[] = [];

/**
 * The exhaustive dispatcher (ADR 0047 decision 2). Two compiler gates, not
 * one: the `never` assignment below fails the build on a missing `case`, and
 * each child's `config` prop is annotated with its own `Extract<...>` alias
 * from `widget-catalog.ts`, so the build also fails if the DTO's
 * `z.intersection` stops narrowing through the switch — proved compiling
 * directly in Task 0, so no destructure workaround is needed here.
 */
export function DashboardWidget({ widget, data, now }: DashboardWidgetProps) {
  const title = widgetTitle(widget.title, widget.widgetType);
  const status = data.status;
  const primary = data.status === "ready" ? data.primary : null;
  const series = data.status === "ready" ? data.series : NO_SERIES;
  const resolvedNow = now ?? Date.now();

  switch (widget.widgetType) {
    case "radial_gauge":
      return <RadialGaugeWidget title={title} status={status} primary={primary} config={widget.config} />;
    case "tank_level":
      return <TankLevelWidget title={title} status={status} primary={primary} config={widget.config} />;
    case "value_tile":
      return <ValueTileWidget title={title} status={status} primary={primary} config={widget.config} />;
    case "chart":
      return <ChartWidget title={title} status={status} series={series} config={widget.config} now={resolvedNow} />;
    default: {
      const unreachable: never = widget;
      return unreachable;
    }
  }
}
