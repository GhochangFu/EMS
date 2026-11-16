import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import { ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import type { AnomalyScore } from "@bms/shared";

import { anomalyScoreLine } from "../../lib/anomaly-hourly";
import { anomalyMarkSeries, unusualHours } from "../../lib/anomaly-series";
import { anomalyMarkColour, seriesPalette, useChartTheme } from "../../lib/chart-theme";
import { CHART_SERIES, type WidgetStatus } from "../../lib/widget-catalog";
import { ACCESS_SENTENCE, timeAxisLabel } from "../asset-history/history-format";
import { WidgetFrame } from "./widget-frame";

export const NO_ANOMALY_POINT_SENTENCE = "No point bound.";
export const NO_ANOMALY_SCORES_SENTENCE = "No anomaly scores for this asset yet.";
/** The static draw (no live binding): the widget reads only on a live dashboard. */
export const ANOMALY_STATIC_SENTENCE = "The last 7 days draw on the live dashboard.";
/** The caption under the chart: what is drawn, over what window, and that it is advisory. */
export const ANOMALY_WIDGET_CAPTION = "Anomaly score · last 7 days · advisory";
/** The builder inspector's one line for an anomaly widget, in place of unit and decimals. */
export const ANOMALY_INSPECTOR_NOTE =
  "Advisory. The asset's anomaly score for the last 7 days. The bound point names the asset.";
/** The score line's series name (and the tooltip's). */
export const ANOMALY_SCORE_SERIES_NAME = "Anomaly score";

/** What the live wrapper read for the bound point's asset. */
export type AnomalyWidgetRead = {
  /** The window's ends (epoch ms): the last 168 whole UTC hours. */
  readonly from: number;
  readonly to: number;
  /** Every score of the window; `null` while the read has not answered. */
  readonly scores: readonly AnomalyScore[] | null;
  /** The zone the axis formats times in. */
  readonly zone: string;
};

type AnomalyWidgetProps = {
  title: string;
  status: WidgetStatus;
  /** The bound point's key; `null` when the widget binds none. It names the asset and is not drawn (R16). */
  pointKey: string | null;
  /** The read answered 403: the access sentence, and nothing else. */
  forbidden?: boolean;
  /** `null` is the static draw, for the dispatcher that reads nothing. */
  read: AnomalyWidgetRead | null;
};

/**
 * `E1.2d` / ADR 0135 Amendment 5 ruling 4(c) — the `anomaly` widget, presentational: the asset's
 * hourly anomaly score (the larger detector's, `anomalyScoreLine`) over the last 7 days on a 0..1
 * axis, a dashed line at `ANOMALY_UNUSUAL_SCORE`, and a mark on each unusual hour whose tooltip
 * names the detectors and the contributing points (`anomaly-series.ts`, the history chart's marks).
 * An unscored hour is a gap. The caption says it is advisory; nothing here raises an alarm.
 *
 * Three states of its own: no point bound; an asset with no score yet; and a 403, which says only
 * the access sentence.
 */
export function AnomalyWidget({ title, status, pointKey, forbidden = false, read }: AnomalyWidgetProps) {
  const { roles, theme } = useChartTheme();

  const option = useMemo<EChartsOption | null>(() => {
    if (read === null || pointKey === null || read.scores === null || read.scores.length === 0) {
      return null;
    }
    const line = anomalyScoreLine(read.scores, read.from, read.to);
    const lineColour = seriesPalette(roles)[0] ?? roles.ink;
    return {
      grid: { left: 40, right: 16, top: 24, bottom: 24 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "time", min: read.from, max: read.to, axisLabel: timeAxisLabel(read.zone) },
      yAxis: { type: "value", min: 0, max: 1 },
      series: [
        {
          name: ANOMALY_SCORE_SERIES_NAME,
          type: CHART_SERIES.line.type,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: lineColour },
          itemStyle: { color: lineColour },
          data: line.map((point) => [point.t, point.v] as [string, number | null]),
          markLine: {
            silent: true,
            symbol: "none",
            label: { formatter: String(ANOMALY_UNUSUAL_SCORE) },
            lineStyle: { type: "dashed", color: anomalyMarkColour(roles) },
            data: [{ yAxis: ANOMALY_UNUSUAL_SCORE }],
          },
        },
        ...anomalyMarkSeries({
          hours: unusualHours(read.scores, read.from, read.to),
          colour: anomalyMarkColour(roles),
          yAxisIndex: 0,
        }),
      ],
    } as EChartsOption;
  }, [read, pointKey, roles]);

  if (pointKey === null || forbidden || read === null) {
    const sentence =
      pointKey === null ? NO_ANOMALY_POINT_SENTENCE : forbidden ? ACCESS_SENTENCE : ANOMALY_STATIC_SENTENCE;
    return (
      <WidgetFrame title={title} status={pointKey === null || forbidden ? "ready" : status}>
        <p className="text-xs text-ink-muted">{sentence}</p>
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame title={title} status={status}>
      {read.scores !== null && read.scores.length === 0 ? (
        <p className="text-xs text-ink-muted" data-testid="anomaly-widget-none">
          {NO_ANOMALY_SCORES_SENTENCE}
        </p>
      ) : (
        <div className="relative min-h-0 flex-[1_1_180px]">
          {option === null ? null : (
            <ReactECharts option={option} theme={theme} style={{ position: "absolute", inset: 0, height: "100%" }} notMerge />
          )}
        </div>
      )}
      <p className="mt-1 text-xs text-ink-muted" data-testid="anomaly-widget-caption">
        {ANOMALY_WIDGET_CAPTION}
      </p>
    </WidgetFrame>
  );
}
