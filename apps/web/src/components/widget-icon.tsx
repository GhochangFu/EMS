import type { WidgetIcon } from "@bms/shared";

import { WIDGET_ICON_PATH } from "../lib/widget-catalog";

/**
 * The icon element for a config-carried icon **name**.
 *
 * `F3.28` (task 2.4) — extracted from `value-tile-widget.tsx` unchanged, so the
 * KPI ribbon (`F3.28` task 2.5) and `/cr-overview` (task 2.7) can render the
 * same glyph a `value_tile` uses without importing a widget renderer.
 *
 * This is the `.tsx` half of the split `widget-value.ts` cannot do: that file
 * is `.ts` and `KpiTile.icon` is a `ReactNode`, so the name travels through
 * `KpiTileWidgetProps` and becomes an element here. `WIDGET_ICON_PATH` is keyed
 * by the same closed enum the contract declares, so an unknown name cannot
 * arrive — but it is read defensively anyway, because a name that somehow did
 * would otherwise render `<path d={undefined}>`: an invisible element rather
 * than an absent one, which is harder to notice.
 */
export function WidgetIconGlyph(name: WidgetIcon | undefined) {
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
