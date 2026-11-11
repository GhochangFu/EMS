import type { DeviceHealthResponse } from "@bms/shared";

import { deviceHealthCounts } from "../../lib/device-health-format";
import { KpiTile, type KpiTileStatus } from "../kpi-tile";

/**
 * `F3.16` / ADR 0127 decisions 19 and 20 — the admin RTUs page's device-health
 * header tiles. A "Not monitored" RTU counts in none of them.
 */

/** Monitored / Online / Stale / Offline over the RTUs the read answered for (decision 19). */
export function DeviceHealthTiles({
  data,
  status,
}: {
  data: DeviceHealthResponse | undefined;
  status: KpiTileStatus;
}) {
  const counts = data ? deviceHealthCounts(data.items) : null;
  const value = (n: number | undefined) => (n === undefined ? null : String(n));
  return (
    <section aria-label="Device health" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile label="Monitored" status={status} value={value(counts?.monitored)} />
      <KpiTile label="Online" status={status} value={value(counts?.online)} />
      <KpiTile
        label="Stale"
        status={status}
        value={value(counts?.stale)}
        tone={counts && counts.stale > 0 ? "warning" : "default"}
      />
      <KpiTile
        label="Offline"
        status={status}
        value={value(counts?.offline)}
        tone={counts && counts.offline > 0 ? "critical" : "default"}
      />
    </section>
  );
}
