import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import { useAuthStore } from "../stores/auth-store";
import { deleteTariffVersion, fetchTariffLineVersions, fetchTariffLines } from "./tariffs";
import { createLocationTariff, deleteLocationTariff } from "./tariffs-location";

/**
 * `F4.365` U8 (ADR 0134) — the tariff clients: what each call sends. A catalog
 * key carries `/`, `&`, `>` and `%`, so the URL `fetch` receives is the
 * observable surface (the `point-key-states.spec.ts` shape). `tariffs.test.ts`
 * is the Vitest entry; `node` environment.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const MAPPING_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const AWKWARD_KEY = "HR|DS-II/LT&>50%";

function stubFetch(status: number, body: unknown): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return body === null ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

function signIn(): void {
  useAuthStore.getState().setSession(
    "token-tariffs",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
    { kind: "global", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
}

export async function versionsCarryAnAwkwardKeyIntactInTheQuery(): Promise<void> {
  signIn();
  const seen = stubFetch(200, { key: AWKWARD_KEY, versions: [] });
  await fetchTariffLineVersions(AWKWARD_KEY, ORG_ID);
  const url = new URL(seen().url);
  expect(url.pathname).toBe("/api/v1/tariffs/lines/versions");
  expect(url.searchParams.get("key")).toBe(AWKWARD_KEY);
  expect(url.searchParams.get("organizationId")).toBe(ORG_ID);
}

export async function linesSendOnlyTheNamedFilters(): Promise<void> {
  signIn();
  const seen = stubFetch(200, { items: [] });
  await fetchTariffLines({ organizationId: ORG_ID, state: "Rajasthan & Co", q: "" });
  const url = new URL(seen().url);
  expect(url.pathname).toBe("/api/v1/tariffs/categories");
  expect([...url.searchParams.keys()].sort()).toEqual(["organizationId", "state"]);
  expect(url.searchParams.get("state")).toBe("Rajasthan & Co");
}

export async function deleteVersionSendsTheReasonAsAQueryParameter(): Promise<void> {
  signIn();
  const seen = stubFetch(204, null);
  await deleteTariffVersion(VERSION_ID, "entered by mistake & redone");
  const url = new URL(seen().url);
  expect(seen().init.method).toBe("DELETE");
  expect(url.href.startsWith(`${BASE}/api/v1/admin/tariffs/versions/${VERSION_ID}?`)).toBe(true);
  expect(url.searchParams.get("reason")).toBe("entered by mistake & redone");
}

export async function aRefusedDeleteThrowsApiErrorWithItsStatus(): Promise<void> {
  signIn();
  stubFetch(409, { message: "already in force", statusCode: 409 });
  const error = await deleteTariffVersion(VERSION_ID, "why not").then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
}

export async function createMappingPostsTheBodyToTheLocation(): Promise<void> {
  signIn();
  const body = {
    tariffKey: AWKWARD_KEY,
    billingMeterAssetId: "44444444-4444-4444-8444-444444444444",
    sanctionedLoad: 50,
    sanctionedLoadUnit: "kw" as const,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
  };
  const seen = stubFetch(200, {
    id: MAPPING_ID,
    organizationId: ORG_ID,
    locationId: LOCATION_ID,
    tariffName: "Domestic",
    dataStatus: "official",
    billingMeterName: "Main meter",
    ...body,
  });
  await createLocationTariff(LOCATION_ID, body);
  expect(seen().url).toBe(`${BASE}/api/v1/admin/locations/${LOCATION_ID}/tariffs`);
  expect(seen().init.method).toBe("POST");
  expect(JSON.parse(String(seen().init.body))).toEqual(body);
}

export async function deleteMappingAddressesTheMapping(): Promise<void> {
  signIn();
  const seen = stubFetch(204, null);
  await deleteLocationTariff(LOCATION_ID, MAPPING_ID);
  expect(seen().url).toBe(`${BASE}/api/v1/admin/locations/${LOCATION_ID}/tariffs/${MAPPING_ID}`);
  expect(seen().init.method).toBe("DELETE");
}
