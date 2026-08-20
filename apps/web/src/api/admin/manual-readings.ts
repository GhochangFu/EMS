import { telemetryWriteResponseSchema } from "@bms/shared/contracts";
import type { TelemetryEntryRow, TelemetryWriteResponse } from "@bms/shared";

import { adminFetch } from "./client";

export async function submitManualReadings(
  rows: TelemetryEntryRow[],
  conflictPolicy?: "reject" | "overwrite",
): Promise<TelemetryWriteResponse> {
  return adminFetch("/admin/telemetry-entry/manual-readings", telemetryWriteResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conflictPolicy ? { rows, conflictPolicy } : { rows }),
  });
}
