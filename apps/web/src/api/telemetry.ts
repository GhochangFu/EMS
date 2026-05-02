import type { TelemetryReading } from "@bms/shared";

import { withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** GET /api/v1/telemetry/points/:pointRef/recent */
export async function fetchTelemetryRecent(
  pointRefEncoded: string,
  window = "15m",
): Promise<TelemetryReading[]> {
  const res = await fetch(
    `${base}/api/v1/telemetry/points/${pointRefEncoded}/recent?window=${encodeURIComponent(window)}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`telemetry ${res.status}`);
  }
  return res.json() as Promise<TelemetryReading[]>;
}
