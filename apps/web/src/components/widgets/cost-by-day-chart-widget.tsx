import ReactECharts from "echarts-for-react";
import { useMemo, useState } from "react";

import { useChartTheme } from "../../lib/chart-theme";
import {
  buildCostByDayOption,
  costRows,
  costTotalLine,
  costWindowOptions,
  costWindowTotal,
  defaultCostWindow,
  rowsInWindow,
} from "../../lib/cost-by-day-chart";
import type { DatasetRow, WidgetStatus } from "../../lib/widget-catalog";
import { WidgetFrame } from "./widget-frame";

type CostByDayChartWidgetProps = {
  title: string;
  status: WidgetStatus;
  stale?: boolean;
  /** The `energy.cost_by_day` rows, oldest first, today last. */
  rows: readonly DatasetRow[];
};

/**
 * `F4.332` (ADR 0047 Amendment 9) — the daily energy cost chart: one bar per local day, a
 * 7 d / 30 d / 90 d viewer switch, and the window total under the plot.
 *
 * The switch only chooses how many of the rows already read to show (decision 4): it makes no
 * request, it is not saved, and the total is always the sum of the bars on screen. The cost is
 * priced hour by hour at the rate in force (ADR 0070 Amendment 7), so a past day keeps its own
 * price when the rate changes — which is why this chart, unlike the stored cost points, carries
 * no "at the rate effective now" note.
 */
export function CostByDayChartWidget({ title, status, stale, rows }: CostByDayChartWidgetProps) {
  const { roles, theme } = useChartTheme();
  const all = useMemo(() => costRows(rows), [rows]);
  const options = costWindowOptions(all.length);
  const [chosen, setChosen] = useState<number | null>(null);
  const days = chosen !== null && options.includes(chosen) ? chosen : defaultCostWindow(all.length);
  const shown = useMemo(() => rowsInWindow(all, days), [all, days]);
  const option = useMemo(() => buildCostByDayOption(shown, roles), [shown, roles]);

  const actions =
    options.length > 1 ? (
      <div role="group" aria-label="Days shown" className="flex shrink-0 gap-1">
        {options.map((windowDays) => (
          <button
            key={windowDays}
            type="button"
            aria-pressed={windowDays === days}
            onClick={() => setChosen(windowDays)}
            className={`rounded px-1.5 py-0.5 text-3xs font-semibold ${
              windowDays === days ? "bg-accent text-on-accent" : "text-ink-muted"
            }`}
          >
            {windowDays} d
          </button>
        ))}
      </div>
    ) : null;

  return (
    <WidgetFrame title={title} status={status} stale={stale} actions={actions}>
      <div className="relative min-h-0 flex-[1_1_220px]">
        <ReactECharts option={option} theme={theme} style={{ position: "absolute", inset: 0, height: "100%" }} notMerge lazyUpdate />
      </div>
      {status === "ready" ? (
        <p className="mt-1 text-2xs text-ink-muted" data-testid="cost-window-total">
          {costTotalLine(costWindowTotal(shown))}
        </p>
      ) : null}
    </WidgetFrame>
  );
}
