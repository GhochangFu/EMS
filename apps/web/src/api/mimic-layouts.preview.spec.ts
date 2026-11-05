import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import { useAuthStore } from "../stores/auth-store";
import { fetchMimicLayoutPreview } from "./mimic-layouts";

/**
 * `F4.308` T5 (ADR 0081 Amendment 2, plan C8) — what the layout preview client sends and how it
 * fails. The `generated-site-view.spec.ts` shape: the URL and headers `fetch` receives are the
 * observable surface, parsed rather than compared whole. `mimic-layouts.preview.test.ts` is the
 * Vitest entry; `node` environment, this module renders nothing.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const LAYOUT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "token-preview";

const VALID_BODY = {
  dashboardId: LAYOUT_ID,
  resolvedAt: "2026-11-05T10:00:00.000Z",
  widgets: [],
  stateMaps: [],
};

/** Captures the one request and answers with `status`/`body`. Per-call state. */
function stubFetch(status: number, body: unknown): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

function signIn(): void {
  useAuthStore.getState().setSession(
    TOKEN,
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "global", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
}

/** T5a — the read goes to `/api/v1/mimic-layouts/:id/preview` with the group as `assetGroupId`. */
export async function hitsThePreviewPath(): Promise<void> {
  const seen = stubFetch(200, VALID_BODY);
  await fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID);
  const url = new URL(seen().url);
  expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/mimic-layouts/${LAYOUT_ID}/preview`);
  expect([...url.searchParams.entries()]).toEqual([["assetGroupId", GROUP_ID]]);
}

/** T5b — both ids are encoded: a slash stays in the path segment, an ampersand in the value. */
export async function encodesBothIds(): Promise<void> {
  const seen = stubFetch(200, VALID_BODY);
  await fetchMimicLayoutPreview("a/b", "c&d=e");
  const url = new URL(seen().url);
  expect(url.pathname).toBe("/api/v1/mimic-layouts/a%2Fb/preview");
  expect(url.searchParams.get("assetGroupId")).toBe("c&d=e");
  expect([...url.searchParams.keys()]).toEqual(["assetGroupId"]);
}

/** T5c — the read carries the bearer token `withAuth()` attaches. */
export async function sendsTheBearerToken(): Promise<void> {
  signIn();
  try {
    const seen = stubFetch(200, VALID_BODY);
    await fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID);
    expect(new Headers(seen().init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** T5d — a 401 clears the session it was sent with, then throws an `ApiError` with the status. */
export async function a401ClearsTheSessionAndThrowsAnApiError(): Promise<void> {
  signIn();
  try {
    stubFetch(401, { message: "Unauthorized" });
    const caught = await fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
    expect(useAuthStore.getState().accessToken).toBeNull();
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** T5e — a 404 (a group outside the caller's reach) is an `ApiError` keeping its status. */
export async function a404IsAnApiErrorWithItsStatus(): Promise<void> {
  stubFetch(404, { message: "Asset group not found" });
  const caught = await fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID).then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).status).toBe(404);
}

/** T5f — an off-shape body throws (`checkResponse` throws on drift under vitest). */
export async function throwsOnAnOffShapeBody(): Promise<void> {
  stubFetch(200, { dashboardId: LAYOUT_ID, resolvedAt: VALID_BODY.resolvedAt, widgets: [] });
  await expect(fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID)).rejects.toThrow();
}

/** T5f positive control — the valid body resolves to itself. */
export async function resolvesAValidBody(): Promise<void> {
  stubFetch(200, VALID_BODY);
  await expect(fetchMimicLayoutPreview(LAYOUT_ID, GROUP_ID)).resolves.toEqual(VALID_BODY);
}
