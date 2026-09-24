import type { RollupCoverage } from "@bms/shared";

import type { ValueTileConfig, WidgetStatus } from "../../lib/widget-catalog";
import { toKpiTileProps } from "../../lib/widget-value";
import { KpiTile } from "../kpi-tile";
import { WidgetIconGlyph } from "../widget-icon";

type ValueTileWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  stale?: boolean;
  config: ValueTileConfig;
  /** `F3.35` — the preceding window's number, when `config.compareToPrevious` asked for one. */
  compareValue?: number | null;
  /** `E4.2` — the roll-up coverage of a `sustainability.total` binding; absent
   * for every other metric. */
  coverage?: RollupCoverage | null;
  /** `E4.2` PR 2 sweep — the organization ISO 4217 code for a money metric;
   * null for every other one, which renders the plain number. */
  currency?: string | null;
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
 *
 * **`F3.35` — every presentation decision stays in `toKpiTileProps`.** The tone
 * mapping, the one-slot hint precedence and the delta arithmetic are all pure
 * and tested there; this component turns an icon name into an element and
 * passes the rest through. Adding a second decision here would put half the
 * tile's behaviour outside the coverage denominator.
 */
export function ValueTileWidget({
  title,
  status,
  primary,
  stale,
  config,
  compareValue,
  coverage,
  currency,
}: ValueTileWidgetProps) {
  const props = toKpiTileProps({ title, status, primary, config, compareValue, coverage, currency });
  return <KpiTile {...props} icon={WidgetIconGlyph(props.icon)} stale={stale && status === "ready"} />;
}
