import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { PointAggregateBucket } from "@bms/shared";

import { useChartTheme } from "../../lib/chart-theme";
import { buildEnergyStackOption, type EnergyStack } from "../../lib/energy-stack-option";

/** The status every Energy page section renders from. */
export type EnergySectionStatus = "loading" | "error" | "empty" | "ready";

type Props = {
  stacks: readonly EnergyStack[];
  /** The previous period's total, drawn dashed over the current one; `null` when compare is off. */
  compareTotal: readonly PointAggregateBucket[] | null;
  /** How far the compare buckets move forward to overlay the current period, in ms. */
  spanMs: number;
  status: EnergySectionStatus;
};

/**
 * `F4.299` U6 (ADR 0108 Amendment 1, 7.5) — the Energy page's stacked total
 * trend, by site or by source. The option comes from `buildEnergyStackOption`;
 * the axis, legend and tooltip colours from the ECharts theme object. The
 * loading, error and empty states are fixed sentences (`F4.204`).
 */
export function EnergyStackChart({ stacks, compareTotal, spanMs, status }: Props) {
  const { roles, theme } = useChartTheme();
  const option = useMemo(
    () => buildEnergyStackOption({ stacks, compareTotal, spanMs, roles }),
    [stacks, compareTotal, spanMs, roles],
  );

  if (status === "loading") {
    return (
      <div className="flex h-[300px] items-center justify-center surface-raised text-sm text-ink-muted">
        Loading the load profile…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-critical-wash-strong bg-critical-wash/50 text-sm text-critical-ink">
        Could not load the load profile.
      </div>
    );
  }
  if (status === "empty" || stacks.every((stack) => stack.data.length === 0)) {
    return (
      <div className="flex h-[300px] items-center justify-center surface-raised text-sm text-ink-muted">
        No telemetry in this window — run the simulator.
      </div>
    );
  }

  return (
    <div className="surface-raised p-2">
      <ReactECharts option={option} theme={theme} style={{ height: 300 }} notMerge lazyUpdate />
    </div>
  );
}
