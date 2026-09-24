import {
  pointAggregateResponseSchema,
  pointValuesAtInstantResponseSchema,
  recentTelemetryResponseSchema,
} from "@bms/shared/contracts";
import type {
  PointAggregateFunction,
  PointAggregateResponse,
  PointValuesAtInstantResponse,
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

/**
 * `GET /api/v1/telemetry/points/at-instant` (`F3.28` task 2.6, ADR 0074
 * decision 2 / plan decision 2) — the latest sample at or before `at` for up
 * to `MAX_AT_INSTANT_REFS` points, in request order.
 *
 * `refs` is sent as a repeated `refs=` parameter, one `URLSearchParams.append`
 * per ref (plan decision 1's shape for a repeated array parameter). Each ref
 * is `encodePointRef` output, which already applied `encodeURIComponent`
 * once; `URLSearchParams` percent-encodes it again when serialising the query
 * string (its own `%` becomes `%25`). This looks like double-encoding, and it
 * is — but it is the form that round-trips: the server side does one implicit
 * decode when Express/`qs` parses the query string, then a second explicit
 * `decodeURIComponent` inside `decodePointRefParam`
 * (`packages/shared/src/index.ts`), matching the two decodes a **path**
 * segment gets (Express's own routing decode, then the same explicit one).
 * Sending the ref only single-encoded here would leave the separator
 * (`TELEMETRY_POINT_REF_SEP`, percent-encoded by `encodePointRef`) decoded one
 * time too few, and `decodePointRefParam` would fail to find it.
 */
export async function fetchPointValuesAt(
  refs: readonly string[],
  atIso: string,
): Promise<PointValuesAtInstantResponse> {
  const query = new URLSearchParams({ at: atIso });
  for (const ref of refs) {
    query.append("refs", ref);
  }
  const res = await fetch(`${base}/api/v1/telemetry/points/at-instant?${query.toString()}`, withAuth());
  if (!res.ok) {
    throw new Error(`telemetry at-instant ${res.status}`);
  }
  return checkResponse(
    pointValuesAtInstantResponseSchema,
    await res.json(),
    "telemetry/points/at-instant",
  );
}
