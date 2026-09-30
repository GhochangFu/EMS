import { expect, vi } from "vitest";

import { fetchHealthSummary } from "./asset-health";

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
