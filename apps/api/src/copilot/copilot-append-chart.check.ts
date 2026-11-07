/**
 * `F4.324` (ADR 0099 Amendment 16) — `dashboard.widgets.appendChart`'s tab, checked at propose.
 *
 * The append route refuses a missing or unknown `tabKey` on a dashboard with tabs (and any
 * `tabKey` on one without) at Confirm, and no copilot read returns a dashboard's tabs. So the
 * target resolver reads the tab keys with the dashboard row and refuses here, naming the keys, so
 * the model can propose again with one. Pure: the keys and the body's value in, a sentence out.
 */

/** The catalog id this check belongs to (`packages/shared/src/copilot/catalog/dashboards.ts`). */
export const APPEND_CHART_ENTRY_ID = "dashboard.widgets.appendChart";

/** The refusal for this `tabKey` on a dashboard with these tab keys, or `null` when it fits. */
export function appendChartTabRefusal(tabKeys: readonly string[], tabKey: unknown): string | null {
  if (tabKeys.length === 0) {
    return tabKey === undefined ? null : "This dashboard has no tabs; leave tabKey out.";
  }
  if (typeof tabKey !== "string") return `This dashboard has tabs; name one in tabKey: ${tabKeys.join(", ")}.`;
  return tabKeys.includes(tabKey) ? null : `This dashboard has no tab "${tabKey}"; its tabs are: ${tabKeys.join(", ")}.`;
}
