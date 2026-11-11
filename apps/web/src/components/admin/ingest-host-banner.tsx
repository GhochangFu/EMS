import type { DeviceHealthResponse } from "@bms/shared";

import { INGEST_HOST_BANNER, absoluteTime, deviceHealthCounts } from "../../lib/device-health-format";

/**
 * The banner while the ingest host is not reporting (decision 16). Shown only
 * when a monitored RTU is in the answer: with none, nothing is frozen, and a
 * simulator-only estate (decision 20) has no host to report.
 */
export function IngestHostBanner({ data }: { data: DeviceHealthResponse | undefined }) {
  if (!data || data.ingestHost.state === "ok") return null;
  if (deviceHealthCounts(data.items).monitored === 0) return null;
  return (
    <p
      role="status"
      className="rounded border border-warning-line bg-warning-wash p-3 text-sm text-warning-ink"
      title={data.ingestHost.lastBeatAt !== null ? `Last heartbeat ${absoluteTime(data.ingestHost.lastBeatAt)}` : undefined}
    >
      {INGEST_HOST_BANNER}
    </p>
  );
}
