import {
  pointAggregateResponseSchema,
  recentTelemetryResponseSchema,
} from "@bms/shared/contracts";
import type {
  PointAggregateFunction,
  PointAggregateResponse,
  TelemetryReading,
} from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

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
  return checkResponse(recentTelemetryResponseSchema, await res.json(), "telemetry/points/:id/recent");
}

/**
 * `GET /api/v1/telemetry/points/:pointRef/aggregate` — `F3.35` Stage A.
 *
 * Two callers with two different asks, and the difference is deliberate
 * (ADR 0048): a `value_tile` passes `compare` and gets scalar statistics for the
 * window and the one before it; a `chart` passes `bucketFunction` and gets the
 * plotted bucket array beside the same statistics. A tile never asks for buckets
 * and so never pays for up to 2,880 rows.
 */
export async function fetchPointAggregate(
  pointRefEncoded: string,
  options: {
    windowMinutes: number;
    compare?: boolean;
    bucketFunction?: PointAggregateFunction;
  },
): Promise<PointAggregateResponse> {
  const query = new URLSearchParams({ windowMinutes: String(options.windowMinutes) });
  // Sent only when true. The server reads `compare` as a string enum rather than
  // a coerced boolean — `z.coerce.boolean("false")` is `true` — so an explicit
  // "false" would be harmless, but an absent parameter is the clearer request.
  if (options.compare) {
    query.set("compare", "true");
  }
  if (options.bucketFunction) {
    query.set("bucketFunction", options.bucketFunction);
  }
  const res = await fetch(
    `${base}/api/v1/telemetry/points/${pointRefEncoded}/aggregate?${query.toString()}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`telemetry aggregate ${res.status}`);
  }
  return checkResponse(
    pointAggregateResponseSchema,
    await res.json(),
    "telemetry/points/:id/aggregate",
  );
}
