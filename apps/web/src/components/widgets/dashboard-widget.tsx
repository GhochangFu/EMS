import type { DashboardWidgetDto, PointAggregateStats } from "@bms/shared";

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
 *
 * **`stale` (review finding, HIGH) sits BESIDE `status`, not folded into it.**
 * `WidgetStatus`/`KpiTileStatus` is a closed, four-member vocabulary shared with every other
 * `KpiTile` consumer in this app (`dashboard-page.tsx`, `control-room-*-page.tsx`, …) — widening
 * it to a fifth member for one caller would force every existing switch on that type to grow an
 * arm it has no use for. `KpiTile` already carries the same shape as a sibling boolean
 * (`kpi-tile.tsx`'s own `stale` prop, already wired for the fixed dashboards), so a dashboard
 * widget's staleness follows that precedent rather than inventing a second one.
 */
export type WidgetData =
  | { status: Exclude<WidgetStatus, "ready"> }
  | {
      status: Extract<WidgetStatus, "ready">;
      primary: number | null;
      series: readonly WidgetSeries[];
      /** Computed by `dashboard-widget-data.ts`'s `widgetDataFor` from the SAME `isStale`/
       * `FRESH_MS` gate the seven control-room pages use — never a second threshold. */
      stale: boolean;
      /**
       * `F3.35` — the preceding window's number, for a `value_tile` whose config
       * sets `compareToPrevious`. `null` is "no compare asked for, or asked for
       * and not answered"; the delta formatter treats both as no delta rather
       * than as a delta of zero.
       */
      compareValue?: number | null;
      /**
       * `F3.35` — the scalar statistics behind a `chart`'s footer, for the
       * FIRST series. A multi-series chart has one footer and several plots, so
       * one has to be the one described.
       */
      stats?: PointAggregateStats | null;
      /** `F3.35` — the chosen level's bucket width, which the granularity cell reads. */
      bucketSeconds?: number | null;
    };

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
  const stale = data.status === "ready" ? data.stale : false;
  const resolvedNow = now ?? Date.now();
  // `F3.35` — the three fields the aggregate read adds. Narrowed off `"ready"`
  // like every other field above rather than read off `data` directly, so a
  // non-ready widget cannot carry last render's numbers into this one.
  const compareValue = data.status === "ready" ? (data.compareValue ?? null) : null;
  const stats = data.status === "ready" ? (data.stats ?? null) : null;
  const bucketSeconds = data.status === "ready" ? (data.bucketSeconds ?? null) : null;

  switch (widget.widgetType) {
    case "radial_gauge":
      return (
        <RadialGaugeWidget title={title} status={status} primary={primary} stale={stale} config={widget.config} />
      );
    case "tank_level":
      return (
        <TankLevelWidget title={title} status={status} primary={primary} stale={stale} config={widget.config} />
      );
    case "value_tile":
      return (
        <ValueTileWidget
          title={title}
          status={status}
          primary={primary}
          stale={stale}
          config={widget.config}
          compareValue={compareValue}
        />
      );
    case "chart":
      return (
        <ChartWidget
          title={title}
          status={status}
          series={series}
          stale={stale}
          config={widget.config}
          now={resolvedNow}
          stats={stats}
          bucketSeconds={bucketSeconds}
        />
      );
    default: {
      const unreachable: never = widget;
      return unreachable;
    }
  }
}
