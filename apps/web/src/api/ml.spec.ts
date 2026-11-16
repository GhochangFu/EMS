import { expect, vi } from "vitest";

import { encodePointRef } from "@bms/shared";

import { fetchForecastList, fetchPointForecast } from "./ml";

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
