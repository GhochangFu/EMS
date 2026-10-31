import {
  pointAggregateResponseSchema,
  pointRawRecordsResponseSchema,
  pointValuesAtInstantResponseSchema,
  pointsLatestResponseSchema,
  recentTelemetryResponseSchema,
} from "@bms/shared/contracts";
import type {
  PointAggregateFunction,
  PointAggregateResponse,
  PointRawRecordsResponse,
  PointValuesAtInstantResponse,
  PointsLatestResponse,
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
 * `GET /api/v1/telemetry/points/latest` (`F4.176`, ADR 0074 Amendment 2) —
 * the latest sample of each (asset, point key) pair inside the last
 * `windowMinutes`, for up to `MAX_LATEST_ASSET_IDS` (50) assets per call. A pair
 * with no sample in the window is absent from `items`.
 *
 * Asset ids are UUIDs and point keys are plain identifiers, so each is sent
 * once through `URLSearchParams` with no extra encoding — unlike `refs` above,
 * which carry the `::` separator.
 */
export async function fetchPointsLatest(
  assetIds: readonly string[],
  pointKeys: readonly string[],
  windowMinutes = 15,
): Promise<PointsLatestResponse> {
  const query = new URLSearchParams();
  for (const id of assetIds) {
    query.append("assetIds", id);
  }
  for (const key of pointKeys) {
    query.append("pointKeys", key);
  }
  query.set("windowMinutes", String(windowMinutes));
  const res = await fetch(`${base}/api/v1/telemetry/points/latest?${query.toString()}`, withAuth());
  if (!res.ok) {
    throw new Error(`telemetry latest ${res.status}`);
  }
  return checkResponse(pointsLatestResponseSchema, await res.json(), "telemetry/points/latest");
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
    /** Trailing window. Not sent when both `from` and `to` are given (`F4.297`: the server refuses both). */
    windowMinutes?: number;
    /** `F4.297` — a custom range; sent only as a pair. */
    from?: string;
    to?: string;
    compare?: boolean;
    bucketFunction?: PointAggregateFunction;
    /** `F4.297` — per-bucket min/average/max/sampleCount. Sent only when true. */
    bucketStats?: boolean;
  },
): Promise<PointAggregateResponse> {
  const query = new URLSearchParams();
  if (options.from !== undefined && options.to !== undefined) {
    query.set("from", options.from);
    query.set("to", options.to);
  } else if (options.windowMinutes !== undefined) {
    query.set("windowMinutes", String(options.windowMinutes));
  }
  if (options.bucketStats) {
    query.set("bucketStats", "true");
  }
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

/**
 * `GET /api/v1/telemetry/points/:pointRef/raw` (`F4.297`, ADR 0108 decision 1.6) — a
 * newest-first page of stored samples with a `before` cursor. The server's default limit
 * applies when `limit` is absent; `nextBefore` of one page is the `before` of the next.
 */
export async function fetchPointRawRecords(
  pointRefEncoded: string,
  options: { limit?: number; before?: string } = {},
): Promise<PointRawRecordsResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  if (options.before !== undefined) {
    query.set("before", options.before);
  }
  const qs = query.toString();
  const res = await fetch(
    `${base}/api/v1/telemetry/points/${pointRefEncoded}/raw${qs === "" ? "" : `?${qs}`}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`telemetry raw ${res.status}`);
  }
  return checkResponse(pointRawRecordsResponseSchema, await res.json(), "telemetry/points/:id/raw");
}
