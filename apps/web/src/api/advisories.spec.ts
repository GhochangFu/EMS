import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import { useAuthStore } from "../stores/auth-store";
import { fetchAdvisories, fetchAssetAdvisories } from "./advisories";

/**
 * `E1.6b` / ADR 0137 (plan `docs/plans/e1.6-optimisation-advisories.md` T2.1) — the two advisory
 * reads: what they put on the wire, how they parse, and how they fail. `node` environment.
 * Entry point: `advisories.test.ts` (ADR 0014). Fixtures are made up.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ORG = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";
const GROUP = "66666666-6666-4666-8666-666666666666";
const ASSET = "11111111-1111-4111-8111-111111111111";

export const ADVISORIES_BODY = {
  asOf: "2026-11-16T10:20:00.000Z",
  candidates: 1,
  considered: 1,
  advisories: [
    {
      id: `${ASSET}:low_power_factor`,
      kind: "low_power_factor",
      confidence: "estimated",
      organizationId: ORG,
      locationId: SITE,
      assetId: ASSET,
      assetCode: "EM-01",
      assetName: "Incomer meter 1",
      assetRtuName: null,
      assetLocationName: "North Yard",
      timeZone: "Asia/Kolkata",
      windowFrom: "2026-11-08T18:30:00.000Z",
      windowTo: "2026-11-15T18:30:00.000Z",
      headline: "Power factor averaged 0.91 over the last 7 days, below 0.95.",
      lines: ["About 1,234 kVAh could be avoided at a power factor of 0.99 (about 5,289 in 30 days if the last 7 days repeat)."],
      context: [],
      assumptions: ["Target power factor: 0.99 (fixed)."],
      currency: "INR",
      money: null,
      kwh: null,
      kvah: { window: 1234, projected: 5289 },
      co2Kg: null,
      kvar: 21,
      powerFactor: 0.91,
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
  const seen = answer(ADVISORIES_BODY);
  expect(await fetchAdvisories()).toEqual(ADVISORIES_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/advisories`);
  await fetchAdvisories({});
  expect(seen().url).toBe(`${BASE}/api/v1/advisories`);
  await fetchAdvisories({ organizationId: ORG });
  expect(seen().url).toBe(`${BASE}/api/v1/advisories?organizationId=${ORG}`);
  await fetchAdvisories({ organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET });
  expect(seen().url).toBe(`${BASE}/api/v1/advisories?organizationId=${ORG}&locationId=${SITE}`);
  await fetchAdvisories({ assetGroupId: GROUP, assetId: ASSET });
  expect(seen().url).toBe(`${BASE}/api/v1/advisories`);
}

/** The asset read goes to the asset's path and parses. */
export async function theAssetReadHitsItsPathAndParses(): Promise<void> {
  const seen = answer(ADVISORIES_BODY);
  expect(await fetchAssetAdvisories(ASSET)).toEqual(ADVISORIES_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/assets/${ASSET}/advisories`);
  expect(seen().init.method ?? "GET").toBe("GET");
}

/** A body the contract refuses throws (`checkResponse` in test), for both reads. */
export async function aWrongShapeThrows(): Promise<void> {
  answer({ ...ADVISORIES_BODY, advisories: [{ ...ADVISORIES_BODY.advisories[0], kind: "load_shift" }] });
  await expect(fetchAdvisories()).rejects.toThrow();
  answer({ ...ADVISORIES_BODY, candidates: "many" });
  await expect(fetchAssetAdvisories(ASSET)).rejects.toThrow();
}

/** A non-2xx throws an `ApiError` carrying the status, named the way `isForbidden` reads. */
export async function aFailureThrowsAnApiError(): Promise<void> {
  answer({ message: "boom" }, 500);
  const listErr = await fetchAdvisories().catch((e: unknown) => e);
  expect(listErr).toBeInstanceOf(ApiError);
  expect((listErr as ApiError).status).toBe(500);
  expect((listErr as Error).message).toBe("advisories 500");
  answer({ message: "Forbidden" }, 403);
  const assetErr = await fetchAssetAdvisories(ASSET).catch((e: unknown) => e);
  expect(assetErr).toBeInstanceOf(ApiError);
  expect((assetErr as ApiError).status).toBe(403);
  expect((assetErr as Error).message).toBe("asset advisories 403");
}

/** A 401 with the current bearer clears the session, on both reads. */
export async function a401ClearsTheSession(): Promise<void> {
  const signIn = (): void =>
    useAuthStore.getState().setSession(
      "token-adv",
      { id: "u1", email: "viewer@bms.local", displayName: "Viewer", role: "viewer" },
      { kind: "global", locations: [], assetGroups: [], assetIds: [] },
      null,
    );
  try {
    signIn();
    answer({ message: "Unauthorized" }, 401);
    await expect(fetchAdvisories()).rejects.toThrow(/advisories 401$/);
    expect(useAuthStore.getState().accessToken).toBeNull();
    signIn();
    await expect(fetchAssetAdvisories(ASSET)).rejects.toThrow(/asset advisories 401$/);
    expect(useAuthStore.getState().accessToken).toBeNull();
  } finally {
    useAuthStore.getState().clearSession();
  }
}
