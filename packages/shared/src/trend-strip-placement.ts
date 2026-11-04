/**
 * `F4.306` / ADR 0108 Amendment 7 (owner OQ1) — where a trend strip goes on one tab. The one rule
 * the append route's trend arm and the wizard's builder draft both read, so the route and the
 * draft never place a strip in two different places.
 *
 * - The tab has a `trend_strip`: replace it. With more than one, the one with the lowest `gridY`,
 *   then the lowest `gridX`, then the first in the list.
 * - The tab has none: insert at its foot, `max(gridY + gridH)` over the tab's widgets, `0` for an
 *   empty tab.
 *
 * Pure: no code, no organization, no segment. Code, not a contract.
 */

/** The fields of a widget on the tab that the rule reads. */
export type TrendStripPlacementWidget = {
  readonly widgetType: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridH: number;
};

export type TrendStripPlacement =
  | { readonly kind: "replace"; readonly index: number }
  | { readonly kind: "insert"; readonly gridY: number };

/** Where a trend strip goes on one tab: replace its first `trend_strip`, or insert at the tab's foot. */
export function placeTrendStrip(tabWidgets: readonly TrendStripPlacementWidget[]): TrendStripPlacement {
  let best = -1;
  let foot = 0;
  for (const [index, widget] of tabWidgets.entries()) {
    foot = Math.max(foot, widget.gridY + widget.gridH);
    if (widget.widgetType !== "trend_strip") continue;
    const current = tabWidgets[best];
    if (
      current === undefined ||
      widget.gridY < current.gridY ||
      (widget.gridY === current.gridY && widget.gridX < current.gridX)
    ) {
      best = index;
    }
  }
  return best >= 0 ? { kind: "replace", index: best } : { kind: "insert", gridY: foot };
}
