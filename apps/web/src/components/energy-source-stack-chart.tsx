import { useMemo } from "react";

import type { EnergySourceMixPoint, PointAggregateBucket } from "@bms/shared";

import { useChartTheme } from "../lib/chart-theme";
import type { EnergyStack } from "../lib/energy-stack-option";
import { EnergyStackChart, type EnergySectionStatus } from "./energy/energy-stack-chart";

type Props = {
  points: EnergySourceMixPoint[];
  status: EnergySectionStatus;
  /** `F4.299` — the previous period's total, drawn dashed; absent or `null` when compare is off. */
  compareTotal?: readonly PointAggregateBucket[] | null;
  /** How far the compare buckets move forward, in ms. */
  spanMs?: number;
};

/**
 * `F3.65c` — Grid `ink-faint`, DG `warning`, Solar `accent` from the current roles; the axis,
 * legend and tooltip colours come from the ECharts theme object (plan D2).
 *
 * `F4.299` U6 — a wrapper over the generic {@link EnergyStackChart}: the three source stacks in
 * that colour order, so `option.color` stays `[ink-faint, warning, accent]`.
 */
export function EnergySourceStackChart({ points, status, compareTotal = null, spanMs = 0 }: Props) {
  const { roles } = useChartTheme();
  const stacks = useMemo<EnergyStack[]>(
    () => [
      { name: "Grid", colour: roles["ink-faint"], data: points.map((p): [string, number] => [p.t, p.gridKw]) },
      { name: "DG (nominal)", colour: roles.warning, data: points.map((p): [string, number] => [p.t, p.dgKw]) },
      { name: "Solar", colour: roles.accent, data: points.map((p): [string, number] => [p.t, p.solarKw]) },
    ],
    [points, roles],
  );

  return <EnergyStackChart stacks={stacks} compareTotal={compareTotal} spanMs={spanMs} status={status} />;
}
