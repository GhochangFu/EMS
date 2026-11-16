import { expect, vi } from "vitest";

import { encodePointRef } from "@bms/shared";

import { fetchAnomalyList, fetchAssetAnomalies, fetchForecastList, fetchPastForecast, fetchPointForecast } from "./ml";

/**
 * `E1.4a` — the forecast reads' wire shape and contract parse. `node` environment, like
 * `telemetry.spec.ts`. Entry point: `ml.test.ts` (ADR 0014).
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ASSET = "11111111-1111-4111-8111-111111111111";
const REF = encodePointRef(ASSET, "temp c");
const AS_OF = "2026-11-16T10:20:00.000Z";

const FORECAST = {
  asOf: AS_OF,
  forecast: {
    issuedAt: "2026-11-16T10:05:00.000Z",
    modelName: "amazon/chronos-2",
    modelVersion: "0".repeat(40),
    stale: false,
    buckets: [{ t: "2026-11-16T10:00:00.000Z", p10: 1, p50: 2, p90: 3 }],
  },
};

const LIST = {
  items: [
    {
      assetId: ASSET,
      assetCode: "CR-1",
      assetName: "Cold room 1",
      assetRtuName: "WBLDC RTU 1",
      locationId: "22222222-2222-4222-8222-222222222222",
      assetLocationName: "Kolkata DC",
      timeZone: "Asia/Kolkata",
      pointKey: "temp_c",
      unit: "°C",
      issuedAt: "2026-11-16T10:05:00.000Z",
      modelName: "amazon/chronos-2",
      modelVersion: "0".repeat(40),
      stale: false,
      p50Min: -18,
      p50Max: -17,
      p50PeakAt: "2026-11-16T12:00:00.000Z",
    },
  ],
};

/** Answers every fetch with `body` and `status`, and records the URL. */
function answer(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** The point read goes to its path with the encoded ref and parses, `forecast: null` included. */
export async function thePointReadHitsItsPathAndParses(): Promise<void> {
  const seen = answer(FORECAST);
  expect(await fetchPointForecast(REF)).toEqual(FORECAST);
  expect(seen()).toBe(`${BASE}/api/v1/ml/points/${REF}/forecast`);
  answer({ asOf: AS_OF, forecast: null });
  expect((await fetchPointForecast(REF)).forecast).toBeNull();
}

/** The list read goes to its path and parses. */
export async function theListReadHitsItsPathAndParses(): Promise<void> {
  const seen = answer(LIST);
  expect(await fetchForecastList()).toEqual(LIST);
  expect(seen()).toBe(`${BASE}/api/v1/ml/forecasts`);
}

/** A wrong shape throws in test (`checkResponse`), and a non-2xx names its status. */
export async function aWrongShapeOrAFailureThrows(): Promise<void> {
  answer({ asOf: AS_OF });
  await expect(fetchPointForecast(REF)).rejects.toThrow();
  answer({ items: [{ ...LIST.items[0], p50Min: "low" }] });
  await expect(fetchForecastList()).rejects.toThrow();
  answer({ message: "Forbidden" }, 403);
  await expect(fetchPointForecast(REF)).rejects.toThrow(/ml forecast 403$/);
  answer({ message: "boom" }, 500);
  await expect(fetchForecastList()).rejects.toThrow(/ml forecasts 500$/);
}

/**
 * `E1.4e` — the past read sends its window as query parameters and parses `{ asOf, buckets }`; a
 * failure names its status, the shape `isForbidden` reads.
 */
export async function thePastReadSendsItsWindowAndParses(): Promise<void> {
  const from = "2026-11-15T10:20:00.000Z";
  const to = "2026-11-16T10:20:00.000Z";
  const body = { asOf: AS_OF, buckets: [{ t: "2026-11-16T09:00:00.000Z", p50: -27.5 }] };
  const seen = answer(body);
  expect(await fetchPastForecast(REF, from, to)).toEqual(body);
  expect(seen()).toBe(
    `${BASE}/api/v1/ml/points/${REF}/forecast/past?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  answer({ asOf: AS_OF, buckets: [{ t: "2026-11-16T09:00:00.000Z" }] });
  await expect(fetchPastForecast(REF, from, to)).rejects.toThrow();
  answer({ message: "Forbidden" }, 403);
  await expect(fetchPastForecast(REF, from, to)).rejects.toThrow(/ml past forecast 403$/);
}


/**
 * `E1.2b` — the asset's anomaly read sends its window and parses `{ asOf, scores }`; a wrong shape
 * throws in test; a failure names its status, the shape `isForbidden` reads.
 */
export async function theAssetAnomalyReadSendsItsWindowAndParses(): Promise<void> {
  const from = "2026-11-15T10:00:00.000Z";
  const to = "2026-11-16T11:00:00.000Z";
  const body = {
    asOf: AS_OF,
    scores: [{ t: "2026-11-16T09:00:00.000Z", detector: "baseline_mad", score: 0.995, contributingPoints: ["temp_c"] }],
  };
  const seen = answer(body);
  expect(await fetchAssetAnomalies(ASSET, from, to)).toEqual(body);
  expect(seen()).toBe(`${BASE}/api/v1/ml/assets/${ASSET}/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  answer({ asOf: AS_OF, scores: [{ ...body.scores[0], score: 1.5 }] });
  await expect(fetchAssetAnomalies(ASSET, from, to)).rejects.toThrow();
  answer({ message: "Forbidden" }, 403);
  await expect(fetchAssetAnomalies(ASSET, from, to)).rejects.toThrow(/ml asset anomalies 403$/);
}

/** `E1.2b` — the list read goes to its path, with `since` when given, and parses; a wrong shape or a failure throws. */
export async function theAnomalyListReadHitsItsPathAndParses(): Promise<void> {
  const body = {
    asOf: AS_OF,
    since: "2026-11-09T10:00:00.000Z",
    truncated: false,
    items: [
      {
        assetId: ASSET,
        assetCode: "CR-1",
        assetName: "Cold room 1",
        assetRtuName: null,
        locationId: "22222222-2222-4222-8222-222222222222",
        assetLocationName: "Kolkata DC",
        timeZone: "Asia/Kolkata",
        t: "2026-11-16T09:00:00.000Z",
        detector: "isolation_forest",
        score: 0.999,
        contributingPoints: ["temp_c", "door_open"],
      },
    ],
  };
  const seen = answer(body);
  expect(await fetchAnomalyList()).toEqual(body);
  expect(seen()).toBe(`${BASE}/api/v1/ml/anomalies`);
  await fetchAnomalyList("2026-11-10T00:00:00.000Z");
  expect(seen()).toBe(`${BASE}/api/v1/ml/anomalies?since=${encodeURIComponent("2026-11-10T00:00:00.000Z")}`);
  answer({ ...body, truncated: "no" });
  await expect(fetchAnomalyList()).rejects.toThrow();
  answer({ message: "boom" }, 500);
  await expect(fetchAnomalyList()).rejects.toThrow(/ml anomalies 500$/);
}
