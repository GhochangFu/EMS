import type { WidgetIcon } from "@bms/shared";

import { WIDGET_ICON_PATH, type ValueTileConfig, type WidgetStatus } from "../../lib/widget-catalog";
import { toKpiTileProps } from "../../lib/widget-value";
import { KpiTile } from "../kpi-tile";

type ValueTileWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  stale?: boolean;
  config: ValueTileConfig;
  /** `F3.35` — the preceding window's number, when `config.compareToPrevious` asked for one. */
  compareValue?: number | null;
};

/**
 * The icon element for a config-carried icon **name**.
 *
 * This is the `.tsx` half of the split `widget-value.ts` cannot do: that file is
 * `.ts` and `KpiTile.icon` is a `ReactNode`, so the name travels through
 * `KpiTileWidgetProps` and becomes an element here. `WIDGET_ICON_PATH` is keyed
 * by the same closed enum the contract declares, so an unknown name cannot
 * arrive — but it is read defensively anyway, because a name that somehow did
 * would otherwise render `<path d={undefined}>`: an invisible element rather
 * than an absent one, which is harder to notice.
 */
function iconFor(name: WidgetIcon | undefined) {
  if (!name) {
    return undefined;
  }
  const d = WIDGET_ICON_PATH[name];
  if (!d) {
    return undefined;
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

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
}: ValueTileWidgetProps) {
  const props = toKpiTileProps({ title, status, primary, config, compareValue });
  return <KpiTile {...props} icon={iconFor(props.icon)} stale={stale && status === "ready"} />;
}
