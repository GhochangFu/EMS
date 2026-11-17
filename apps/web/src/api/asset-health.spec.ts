import { expect, vi } from "vitest";

import { fetchAssetHealthInputs, fetchHealthBadActors, fetchHealthSummary } from "./asset-health";

/**
 * `F3.72` U1 (plan D3, OQ1) — `fetchHealthSummary`'s filter reaches the wire.
 *
 * An optional field at an adapter is invisible to `tsc` and to every consumer spec that stubs
 * the function: a body that drops `organizationId` compiles and every stub stays green. The URL
 * handed to `fetch` is the only place the filter is observable, so each case pins the exact
 * string. `node` environment, as `dashboards.spec.ts`.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** A contract-valid empty summary (`healthSummaryResponseSchema` is `.strict()`). */
const EMPTY_SUMMARY = {
  score: null,
  assetCount: 0,
  scoredAssetCount: 0,
  unbandedAssetCount: 0,
  unscoredAssetCount: 0,
  bandCounts: [],
  windowFrom: "2026-09-30T00:00:00.000Z",
  windowTo: "2026-09-30T01:00:00.000Z",
  bucketSeconds: 300,
  computedAt: null,
  coveredBuckets: 0,
  expectedBuckets: 12,
};

/** Captures the URL of the single request the call makes. Per-call state, never a lifetime counter. */
function captureUrl(): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(EMPTY_SUMMARY), { status: 200 });
  });
  return () => seen;
}

/** No filter, no `?` at all — the enterprise summary. */
export async function healthSummarySendsNoQueryWhenUnfiltered(): Promise<void> {
  const seen = captureUrl();
  await fetchHealthSummary();
  expect(seen()).toBe(`${BASE}/api/v1/asset-health/summary`);
}

/** `locationId` alone. */
export async function healthSummarySendsLocationIdAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchHealthSummary({ locationId: LOCATION_ID });
  expect(seen()).toBe(`${BASE}/api/v1/asset-health/summary?locationId=${LOCATION_ID}`);
}

/** `organizationId` alone. */
export async function healthSummarySendsOrganizationIdAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchHealthSummary({ organizationId: ORG_ID });
  expect(seen()).toBe(`${BASE}/api/v1/asset-health/summary?organizationId=${ORG_ID}`);
}

/** Both, each under its own key. */
export async function healthSummarySendsBothFilters(): Promise<void> {
  const seen = captureUrl();
  await fetchHealthSummary({ organizationId: ORG_ID, locationId: LOCATION_ID });
  expect(seen()).toBe(
    `${BASE}/api/v1/asset-health/summary?locationId=${LOCATION_ID}&organizationId=${ORG_ID}`,
  );
}

// ---------------------------------------------------------------------------
// `E1.8b` T2.1 (plan §7) — the two health-inputs reads of ADR 0050 Amendment 5.
// ---------------------------------------------------------------------------

const ASSET_ID = "22222222-2222-4222-8222-222222222222";

/** A contract-valid `GET …/inputs` answer with both facts absent. */
const INPUTS = {
  assetId: ASSET_ID,
  asOf: "2026-11-17T10:00:00.000Z",
  inputs: [
    { key: "operational", status: "scored" },
    { key: "historical", status: "advisory" },
    { key: "maintenance", status: "fact_only" },
    { key: "environmental", status: "no_source" },
    { key: "utilisation", status: "no_reference" },
  ],
  anomalyHistory: null,
  maintenance: null,
};

/** A contract-valid empty `GET /asset-health/bad-actors` answer. */
const BAD_ACTORS = {
  asOf: "2026-11-17T10:00:00.000Z",
  scoredAssetCount: 0,
  lowestScores: [],
  anomaly: null,
};

/** Captures the URL of the one request and answers `body` with `status`. Per-call state. */
function answer(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** The inputs read goes to the asset's own path. */
export async function inputsReadsTheAssetsPath(): Promise<void> {
  const seen = answer(INPUTS);
  const data = await fetchAssetHealthInputs(ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/asset-health/assets/${ASSET_ID}/inputs`);
  expect(data.inputs.map((input) => input.key)).toEqual([
    "operational", "historical", "maintenance", "environmental", "utilisation",
  ]);
}

/** A wrong shape throws in test (ADR 0030 decision 5), never reaches a card. */
export async function inputsThrowsOnAWrongShape(): Promise<void> {
  answer({ ...INPUTS, inputs: INPUTS.inputs.slice(0, 4) });
  await expect(fetchAssetHealthInputs(ASSET_ID)).rejects.toThrow();
}

/** A 500 throws with the route's name and the status. */
export async function inputsThrowsOnA500(): Promise<void> {
  answer({ message: "boom" }, 500);
  await expect(fetchAssetHealthInputs(ASSET_ID)).rejects.toThrow("asset-health/assets/:assetId/inputs 500");
}

/** The bad-actors read sends no query when unfiltered, and each filter only when set. */
export async function badActorsSendsEachFilterOnlyWhenSet(): Promise<void> {
  const none = answer(BAD_ACTORS);
  await fetchHealthBadActors({});
  expect(none()).toBe(`${BASE}/api/v1/asset-health/bad-actors`);

  const org = answer(BAD_ACTORS);
  await fetchHealthBadActors({ organizationId: ORG_ID, locationId: undefined });
  expect(org()).toBe(`${BASE}/api/v1/asset-health/bad-actors?organizationId=${ORG_ID}`);

  const loc = answer(BAD_ACTORS);
  await fetchHealthBadActors({ locationId: LOCATION_ID });
  expect(loc()).toBe(`${BASE}/api/v1/asset-health/bad-actors?locationId=${LOCATION_ID}`);

  const both = answer(BAD_ACTORS);
  await fetchHealthBadActors({ organizationId: ORG_ID, locationId: LOCATION_ID });
  expect(both()).toBe(
    `${BASE}/api/v1/asset-health/bad-actors?locationId=${LOCATION_ID}&organizationId=${ORG_ID}`,
  );
}

/** A wrong shape throws in test. */
export async function badActorsThrowsOnAWrongShape(): Promise<void> {
  answer({ ...BAD_ACTORS, scoredAssetCount: -1 });
  await expect(fetchHealthBadActors({})).rejects.toThrow();
}

/** A 500 throws with the route's name and the status. */
export async function badActorsThrowsOnA500(): Promise<void> {
  answer({ message: "boom" }, 500);
  await expect(fetchHealthBadActors({})).rejects.toThrow("asset-health/bad-actors 500");
}
