import type { ValueTileConfig, WidgetStatus } from "../../lib/widget-catalog";
import { toKpiTileProps } from "../../lib/widget-value";
import { KpiTile } from "../kpi-tile";

type ValueTileWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  stale?: boolean;
  config: ValueTileConfig;
};

/**
 * `value_tile` on the `kpi-tile.tsx` shape.
 *
 * **Deliberately does NOT wrap in `WidgetFrame`.** `KpiTile` is already the
 * frame for this shape — its own border, background and shadow — and
 * wrapping it a second time would draw two borders around one tile. This is
 * the one asymmetry among the four renderers; do not "fix" it into
 * consistency with the other three.
 *
 * `stale` is forwarded straight to `KpiTile`'s own `stale` prop (review
 * finding, HIGH) — the same ring and "Stale · no telemetry ~10s" line
 * `dashboard-page.tsx` already drives from ADR 0027, not a second wording.
 */
export function ValueTileWidget({ title, status, primary, stale, config }: ValueTileWidgetProps) {
  return <KpiTile {...toKpiTileProps({ title, status, primary, config })} stale={stale && status === "ready"} />;
}
