import type {
  DashboardWidgetDto,
  MetricCatalogValueDto,
  PointAggregateStats,
} from "@bms/shared";

import type { WidgetSeries, WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { ChartWidget } from "./chart-widget";
import { RadialGaugeWidget } from "./radial-gauge-widget";
import { TankLevelWidget } from "./tank-level-widget";
import { TableWidget } from "./table-widget";
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
    }
  | WidgetRowsData;

/**
 * What a `table` widget draws (`F3.35` Stage B) — the third `WidgetData` shape, beside "not
 * ready" and "one number plus series".
 *
 * **A separate arm rather than optional `rows?`/`columns?` on the scalar arm**, and the reason
 * is the one `stale`'s docblock above gives one axis over: four of the five widget types have
 * no rows, so optional fields would make every renderer type-check against a shape it ignores
 * and would hand `TableWidget` two fields it must defend against being `undefined`. Here the
 * fields are required, and only the arm that has them can be read for them.
 *
 * **No `kind` discriminant, deliberately.** Sixteen sites construct the scalar ready arm, twelve
 * of them in specs, and a required tag would have edited every one to say what its own fields
 * already say. `isRowsData` names the `in` narrowing once so no call site writes the check.
 *
 * `truncated` is carried rather than inferred, for `metricCatalogValueDtoSchema`'s own reason: a
 * caller cannot tell a dataset holding exactly `MAX_DATASET_ROWS` rows from one cut off at it,
 * and the difference decides whether the card is showing the whole answer.
 */
export type WidgetRowsData = {
  status: Extract<WidgetStatus, "ready">;
  columns: readonly string[];
  rows: readonly DatasetRow[];
  truncated: boolean;
  stale: boolean;
};

/** One resolved dataset row, as the catalog endpoint returns it. Derived, never restated. */
export type DatasetRow = Extract<MetricCatalogValueDto, { shape: "dataset" }>["rows"][number];

/**
 * The one place the rows arm is recognised.
 *
 * `"rows" in data` rather than a tag, and named here so the narrowing is written once — a
 * consumer that inlined it would be a second declaration of which arm is which, and the two
 * would drift the day a scalar arm gains an unrelated `rows` field.
 */
export function isRowsData(data: WidgetData): data is WidgetRowsData {
  return data.status === "ready" && "rows" in data;
}

/** The scalar ready arm — everything `"ready"` that is not a dataset. */
export type WidgetScalarData = Exclude<
  Extract<WidgetData, { status: Extract<WidgetStatus, "ready"> }>,
  WidgetRowsData
>;

/**
 * The counterpart to `isRowsData`, and the reason it exists is worth stating.
 *
 * Before Stage B, `data.status === "ready"` narrowed to exactly one object type, so every
 * caller read `.primary` straight off it. Two ready arms end that: `status` alone no longer
 * decides which fields exist. This is the one check a caller writes instead, so the answer to
 * "which ready arm is this" is given in one place rather than at twenty call sites.
 */
export function isScalarData(data: WidgetData): data is WidgetScalarData {
  return data.status === "ready" && !("rows" in data);
}

type DashboardWidgetProps = {
  widget: DashboardWidgetDto;
  data: WidgetData;
  /** Injected reference time, defaulted to the clock read here at render — never inside a pure builder (see `widget-echarts-option.ts`). */
  now?: number;
};

const NO_SERIES: readonly WidgetSeries[] = [];
// Module-level constants, like `NO_SERIES` above: a fresh `[]` on every render is a new
// reference, which defeats the memoisation of any child that compares props by identity.
const NO_COLUMNS: readonly string[] = [];
const NO_ROWS: readonly DatasetRow[] = [];

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
  // `F3.35` Stage B — narrowed to the SCALAR ready arm once, rather than each field repeating
  // `data.status === "ready"`. The rows arm is also `"ready"` and carries none of these fields,
  // so the old per-field check no longer narrows on its own.
  const scalar = isScalarData(data) ? data : null;
  const rowsData = isRowsData(data) ? data : null;
  const primary = scalar?.primary ?? null;
  const series = scalar?.series ?? NO_SERIES;
  const stale = data.status === "ready" ? data.stale : false;
  const resolvedNow = now ?? Date.now();
  // `F3.35` — the three fields the aggregate read adds. Narrowed like every other field above
  // rather than read off `data` directly, so a non-ready widget cannot carry last render's
  // numbers into this one.
  const compareValue = scalar?.compareValue ?? null;
  const stats = scalar?.stats ?? null;
  const bucketSeconds = scalar?.bucketSeconds ?? null;

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
    case "table":
      return (
        <TableWidget
          title={title}
          status={status}
          stale={stale}
          config={widget.config}
          columns={rowsData?.columns ?? NO_COLUMNS}
          rows={rowsData?.rows ?? NO_ROWS}
          truncated={rowsData?.truncated ?? false}
        />
      );
    default: {
      const unreachable: never = widget;
      return unreachable;
    }
  }
}
