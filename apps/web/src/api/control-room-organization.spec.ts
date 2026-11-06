import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import { useAuthStore } from "../stores/auth-store";
import { fetchOrganizationControlRoomView, makeOrganizationLayout, resetOrganizationLayout } from "./control-room";

/**
 * `F4.317` task 5.1 — what the organization strip's three clients put on the wire (ADR 0112
 * decisions 3 to 5), and how each fails. The URL, method and body `fetch` receives are the only
 * observable surface. `node` environment: this module renders nothing.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const PATH = `${BASE}/api/v1/control-room/organizations/${ORG_ID}/view`;

const VIEW = {
  organizationId: ORG_ID,
  kind: "stock",
  dashboardId: null,
  dashboardSlug: null,
  layoutName: "Organization standard",
  canManage: false,
  tiles: [],
  resolvedAt: "2026-11-06T10:00:00.000Z",
};

const MADE = { organizationId: ORG_ID, dashboardId: DASHBOARD_ID, dashboardSlug: "org-layout", templateId: TEMPLATE_ID };

type Seen = { url: string; init: RequestInit };

/** Captures the single request the call makes and answers `status` with `body`. */
function stubFetch(status: number, body: unknown): () => Seen {
  let seen: Seen = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  return () => seen;
}

function signIn(): void {
  useAuthStore.getState().setSession(
    "token-org",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
}

/** O1 — the read goes to the organization's view path as GET with the bearer token. */
export async function theViewReadHitsTheOrganizationPath(): Promise<void> {
  signIn();
  try {
    const seen = stubFetch(200, VIEW);
    const view = await fetchOrganizationControlRoomView(ORG_ID);
    expect(seen().url).toBe(PATH);
    expect(seen().init.method ?? "GET").toBe("GET");
    expect(new Headers(seen().init.headers).get("Authorization")).toBe("Bearer token-org");
    expect(view.kind).toBe("stock");
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** O2 — a 404 throws an ApiError that carries the status. */
export async function theViewReadThrowsOn404(): Promise<void> {
  stubFetch(404, "not found");
  const err = await fetchOrganizationControlRoomView(ORG_ID).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(404);
}

/** O3 — a body that fails the contract throws rather than rendering. */
export async function theViewReadThrowsOnSchemaMismatch(): Promise<void> {
  stubFetch(200, { ...VIEW, kind: "other" });
  await expect(fetchOrganizationControlRoomView(ORG_ID)).rejects.toThrow();
}

/** O4 — Make is a PUT of an empty object to the same path, and answers the result. */
export async function makeSendsAnEmptyPut(): Promise<void> {
  const seen = stubFetch(200, MADE);
  const result = await makeOrganizationLayout(ORG_ID);
  expect(seen().url).toBe(PATH);
  expect(seen().init.method).toBe("PUT");
  expect(seen().init.body).toBe("{}");
  expect(result.dashboardId).toBe(DASHBOARD_ID);
}

/** O5 — the 409 "Reset to default first" throws an ApiError with the status and the body. */
export async function makeThrowsTheConflictWithItsBody(): Promise<void> {
  const body = { message: "This organization already has a layout. Reset to default first.", statusCode: 409 };
  stubFetch(409, body);
  const err = await makeOrganizationLayout(ORG_ID).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(409);
  expect((err as ApiError).message).toContain("Reset to default first");
}

/** O6 — Reset is a DELETE of the same path and resolves on 204. */
export async function resetSendsADelete(): Promise<void> {
  const seen = stubFetch(204, null);
  await expect(resetOrganizationLayout(ORG_ID)).resolves.toBeUndefined();
  expect(seen().url).toBe(PATH);
  expect(seen().init.method).toBe("DELETE");
}

/** O7 — a refused Reset throws an ApiError with the status. */
export async function resetThrowsOn403(): Promise<void> {
  stubFetch(403, "forbidden");
  const err = await resetOrganizationLayout(ORG_ID).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(403);
}
