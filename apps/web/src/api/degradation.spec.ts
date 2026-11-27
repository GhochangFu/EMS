import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import { useAuthStore } from "../stores/auth-store";
import { fetchAssetDegradation, fetchDegradation } from "./degradation";

/**
 * `E1.5b` / ADR 0138 (plan `docs/plans/e1.5-degradation-trends.md` T2.1) — the two degradation
 * reads: what they put on the wire, how they parse, and how they fail. `node` environment.
 * Entry point: `degradation.test.ts` (ADR 0014). Fixtures are made up.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ORG = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";
const GROUP = "66666666-6666-4666-8666-666666666666";
const ASSET = "11111111-1111-4111-8111-111111111111";

export const DEGRADATION_BODY = {
  asOf: "2026-11-16T10:20:00.000Z",
  candidates: 1,
  considered: 1,
  assets: [
    {
      assetId: ASSET,
      organizationId: ORG,
      locationId: SITE,
      assetCode: "EM-01",
      assetName: "Incomer meter 1",
      assetRtuName: null,
      assetLocationName: "North Yard",
      timeZone: "Asia/Kolkata",
      windowFrom: "2026-10-19",
      windowTo: "2026-11-15",
      indicators: [
        {
          id: `${ASSET}:health`,
          kind: "health",
          status: "crossing",
          pointKey: null,
          unit: "%",
          current: 71,
          limit: 60,
          limitSource: { kind: "band", name: "Fair" },
          slopePerWeek: -2.5,
          daysToLimit: { min: 20, max: 30 },
          daysWithData: 26,
          summary: "Trending down: reaches Fair in about 20–30 days",
          sentence: "At the trend of the last 28 days, the health score reaches Fair in about 20–30 days.",
          detail: "Now 71% (mean of the last 3 days). Limit 60%.",
          assumptions: ["A straight-line trend."],
        },
      ],
      scheduleNotes: [],
    },
  ],
};

type Seen = { url: string; init: RequestInit };

/** Answers every fetch with `body` and `status`, and records the last request. */
function answer(body: unknown, status = 200): () => Seen {
  let seen: Seen = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** The list read: the bare path with no filter, and only `organizationId` and `locationId` otherwise. */
export async function theListReadSendsOnlyOrganizationAndLocation(): Promise<void> {
  const seen = answer(DEGRADATION_BODY);
  expect(await fetchDegradation()).toEqual(DEGRADATION_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/degradation`);
  await fetchDegradation({});
  expect(seen().url).toBe(`${BASE}/api/v1/degradation`);
  await fetchDegradation({ organizationId: ORG });
  expect(seen().url).toBe(`${BASE}/api/v1/degradation?organizationId=${ORG}`);
  await fetchDegradation({ organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET });
  expect(seen().url).toBe(`${BASE}/api/v1/degradation?organizationId=${ORG}&locationId=${SITE}`);
  await fetchDegradation({ assetGroupId: GROUP, assetId: ASSET });
  expect(seen().url).toBe(`${BASE}/api/v1/degradation`);
}

/** The asset read goes to the asset's path and parses. */
export async function theAssetReadHitsItsPathAndParses(): Promise<void> {
  const seen = answer(DEGRADATION_BODY);
  expect(await fetchAssetDegradation(ASSET)).toEqual(DEGRADATION_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/assets/${ASSET}/degradation`);
  expect(seen().init.method ?? "GET").toBe("GET");
}

/** A body the contract refuses throws, for both reads. */
export async function aWrongShapeThrows(): Promise<void> {
  const bad = { ...DEGRADATION_BODY.assets[0], indicators: [{ ...DEGRADATION_BODY.assets[0]?.indicators[0], status: "soon" }] };
  answer({ ...DEGRADATION_BODY, assets: [bad] });
  await expect(fetchDegradation()).rejects.toThrow();
  answer({ ...DEGRADATION_BODY, candidates: "many" });
  await expect(fetchAssetDegradation(ASSET)).rejects.toThrow();
}

/** A non-2xx throws an `ApiError` carrying the status, named the way `isForbidden` reads. */
export async function aFailureThrowsAnApiError(): Promise<void> {
  answer({ message: "boom" }, 500);
  const listErr = await fetchDegradation().catch((e: unknown) => e);
  expect(listErr).toBeInstanceOf(ApiError);
  expect((listErr as ApiError).status).toBe(500);
  expect((listErr as Error).message).toBe("degradation 500");
  answer({ message: "Forbidden" }, 403);
  const assetErr = await fetchAssetDegradation(ASSET).catch((e: unknown) => e);
  expect(assetErr).toBeInstanceOf(ApiError);
  expect((assetErr as ApiError).status).toBe(403);
  expect((assetErr as Error).message).toBe("asset degradation 403");
}

/** A 401 with the current bearer clears the session, on both reads. */
export async function a401ClearsTheSession(): Promise<void> {
  const signIn = (): void =>
    useAuthStore.getState().setSession(
      "token-deg",
      { id: "u1", email: "viewer@bms.local", displayName: "Viewer", role: "viewer" },
      { kind: "global", locations: [], assetGroups: [], assetIds: [] },
      null,
    );
  try {
    signIn();
    answer({ message: "Unauthorized" }, 401);
    await expect(fetchDegradation()).rejects.toThrow(/degradation 401$/);
    expect(useAuthStore.getState().accessToken).toBeNull();
    signIn();
    await expect(fetchAssetDegradation(ASSET)).rejects.toThrow(/asset degradation 401$/);
    expect(useAuthStore.getState().accessToken).toBeNull();
  } finally {
    useAuthStore.getState().clearSession();
  }
}
