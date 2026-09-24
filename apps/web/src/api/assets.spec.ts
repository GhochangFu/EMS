import { expect, vi } from "vitest";

import { fetchAssetRoleSummary } from "./assets";

/**
 * `F3.28` (ADR 0074, plan task 3.3) — what the class strip's fetcher puts on
 * the wire.
 *
 * The strip's spec replaces this module with a `vi.fn`, so a fetcher that
 * dropped its `assetIds` would keep that spec green. The URL handed to `fetch`
 * is the only place it is observable; it is parsed rather than compared whole,
 * so a mutation to one part reddens the claim about that part and no other.
 *
 * `node` environment, like `alarms.spec.ts`.
 */

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const IDS = [ID_A, ID_B, ID_C];

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Captures the URL of the single request the call makes and answers with
 * `body`, which must pass the fetcher's `checkResponse`. Per-call closure
 * state, never a lifetime counter (§4.6).
 */
function captureUrl(body: unknown): () => URL {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return () => new URL(seen);
}

const EMPTY = { items: [] };

/** The role summary goes to `/api/v1/assets/role-summary`. */
export async function roleSummaryHitsTheRoleSummaryPath(): Promise<void> {
  const seen = captureUrl(EMPTY);
  await fetchAssetRoleSummary(IDS);
  expect(`${seen().origin}${seen().pathname}`).toBe(`${BASE}/api/v1/assets/role-summary`);
}

/** The role summary sends one `assetIds` per id, in the order given. */
export async function roleSummarySendsOneAssetIdsPerIdInOrder(): Promise<void> {
  const seen = captureUrl(EMPTY);
  await fetchAssetRoleSummary(IDS);
  expect(seen().searchParams.getAll("assetIds")).toEqual(IDS);
}
