import type { ValueTileConfig, WidgetStatus } from "../../lib/widget-catalog";
import { toKpiTileProps } from "../../lib/widget-value";
import { KpiTile } from "../kpi-tile";

type ValueTileWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
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
 */
export function ValueTileWidget({ title, status, primary, config }: ValueTileWidgetProps) {
  return <KpiTile {...toKpiTileProps({ title, status, primary, config })} />;
}
