import { expect, vi } from "vitest";

import { fetchDashboards } from "./dashboards";

/**
 * `F3.31` Task 3 — the dashboards web client's `assetId` argument (ADR 0068 decision 4).
 *
 * ## Environment
 *
 * `node`, like `asset-images.spec.ts` — that file settled empirically that importing a module
 * which reads `import.meta.env` at module scope is fine under the web project's merged Vite
 * config.
 *
 * ## Why the URL is the claim
 *
 * An optional parameter at an adapter is invisible to `tsc` and to every fake: a
 * `fetchDashboards(org?, assetId?)` that drops `assetId` on the floor compiles, and every
 * consumer spec that stubs `fetchDashboards` stays green. The only place the argument is
 * observable is the URL handed to `fetch`, so each row below pins the exact string. The
 * compiler proves only that the argument is accepted (`tsc --noEmit` reaches this file through
 * its `.test.ts` wrapper); that it reaches the wire is proven only here, at run time.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Captures the URL of the single request the call under test makes and answers with an
 * empty, contract-valid list. Per-call closure state, never a lifetime counter (§4.6).
 */
function captureUrl(): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  return () => seen;
}

/** W1a — `assetId` alone is the only query key. */
export async function fetchDashboardsSendsAssetIdAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(undefined, ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?assetId=${ASSET_ID}`);
}

/** W1b — both keys, `organizationId` first (the insertion order the helper is given). */
export async function fetchDashboardsSendsOrganizationIdThenAssetId(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(ORG_ID, ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?organizationId=${ORG_ID}&assetId=${ASSET_ID}`);
}

/** W1c — no argument, no `?` at all: the helper answers `""` when no key is defined. */
export async function fetchDashboardsSendsNoQueryWhenUnfiltered(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards();
  expect(seen()).toBe(`${BASE}/api/v1/dashboards`);
}

/**
 * `E4.2` U9 — `section` reaches the wire.
 *
 * The same trap this file's docblock names: `fetchDashboards` gained a third
 * optional argument, so a body that drops it on the floor compiles and every
 * consumer spec that stubs the function stays green. Only the captured URL says
 * it is wired.
 */
export async function fetchDashboardsSendsSectionAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(undefined, undefined, "sustainability");
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?section=sustainability`);
}

/** The three keys together, in the helper's insertion order. */
export async function fetchDashboardsSendsAllThreeKeysInOrder(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(ORG_ID, ASSET_ID, "sustainability");
  expect(seen()).toBe(
    `${BASE}/api/v1/dashboards?organizationId=${ORG_ID}&assetId=${ASSET_ID}&section=sustainability`,
  );
}
