import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { breakerSiteRows } from "../../lib/breaker-site-rows";
import { BreakerTable } from "../control-room/breaker-table";
import { SITE_WIDGET_BODY_CLASS, type SiteWidgetCommon } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

type BreakerTableWidgetProps = SiteWidgetCommon & {
  /**
   * The socket overlay (`useSiteLiveReadings`, owned by `SiteWidgetLive`). `null` is a static draw
   * (the builder): no data either, so the empty line shows and no number does.
   */
  readings: SiteLiveReadings | null;
};

/**
 * `F3.74` (plan D8, ADR 0088 decision 10) — the breaker table: one row per breaker-role member of
 * the bound group (the tab's, else the dashboard's own), in the response's order (role sort order, then code). It reuses the control
 * room's `BreakerTable`; the rows (`breakerSiteRows`) take the state from `deriveBreakerState`
 * over the socket overlay, so a reading flips a row without a refetch.
 */
export function BreakerTableWidget({ title, status, data, readings }: BreakerTableWidgetProps) {
  const rows = data === undefined || readings === null ? [] : breakerSiteRows(data, readings);
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        {rows.length === 0 ? <p className="text-xs text-ink-muted">No breakers in scope</p> : <BreakerTable rows={rows} />}
      </div>
    </WidgetFrame>
  );
}
