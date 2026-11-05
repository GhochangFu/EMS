import { QueryClient } from "@tanstack/react-query";
import { expect, vi } from "vitest";

import type { AdminPointKeyStateDto } from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { useAuthStore } from "../../stores/auth-store";
import {
  adminPointKeyStatesQueryKey,
  createAdminPointKeyState,
  deleteAdminPointKeyState,
  fetchAdminPointKeyStates,
  invalidatePointKeyStateReads,
  updateAdminPointKeyState,
} from "./point-key-states";

/**
 * `F4.309` T8 (ADR 0088 Amendment 3, plan C13) — the state-labels client: what each call sends
 * (URL, method, body) and how it fails (`ApiError` with its status, a 401 clearing the session,
 * `checkResponse` refusing an off-shape body). The `mimic-layouts.preview.spec.ts` shape: the URL
 * and init `fetch` receives are the observable surface. `point-key-states.test.ts` is the Vitest
 * entry; `node` environment, this module renders nothing.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "token-states";

const ROW: AdminPointKeyStateDto = {
  id: ID,
  pointKey: "isolator_pos",
  value: 2,
  label: "EARTHED",
  tone: "open",
  seeded: false,
};

/** Captures the one request and answers with `status`/`body` (`null` → an empty 204 body). */
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
    TOKEN,
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
    { kind: "global", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the call to reject, and it resolved");
    },
    (error: unknown) => error,
  );
}

/** The query key every read and write of this module names. */
export function theListKeyIsAdminPointKeyStates(): void {
  expect(adminPointKeyStatesQueryKey).toEqual(["admin", "point-key-states"]);
}

/** The list is a GET of `/api/v1/admin/point-key-states`, with no query string. */
export async function theListIsAGetOfTheCollection(): Promise<void> {
  const seen = stubFetch(200, { items: [ROW] });
  await expect(fetchAdminPointKeyStates()).resolves.toEqual({ items: [ROW] });
  expect(seen().url).toBe(`${BASE}/api/v1/admin/point-key-states`);
  expect(seen().init.method ?? "GET").toBe("GET");
}

/** Create POSTs the four fields as JSON. */
export async function createPostsTheFourFields(): Promise<void> {
  const seen = stubFetch(201, ROW);
  const body = { pointKey: ROW.pointKey, value: ROW.value, label: ROW.label, tone: ROW.tone };
  await createAdminPointKeyState(body);
  expect(seen().url).toBe(`${BASE}/api/v1/admin/point-key-states`);
  expect(seen().init.method).toBe("POST");
  expect(new Headers(seen().init.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(seen().init.body))).toEqual(body);
}

/** Update PATCHes `/:id` with only the fields it is given — never a key or a value. */
export async function updatePatchesTheIdWithLabelAndTone(): Promise<void> {
  const seen = stubFetch(200, { ...ROW, label: "EARTH" });
  await updateAdminPointKeyState(ID, { label: "EARTH", tone: "tripped" });
  expect(seen().url).toBe(`${BASE}/api/v1/admin/point-key-states/${ID}`);
  expect(seen().init.method).toBe("PATCH");
  expect(JSON.parse(String(seen().init.body))).toEqual({ label: "EARTH", tone: "tripped" });
}

/** Delete is a DELETE of `/:id` with no body, and an empty 204 resolves. */
export async function deleteIsADeleteOfTheIdAndA204Resolves(): Promise<void> {
  const seen = stubFetch(204, null);
  await expect(deleteAdminPointKeyState(ID)).resolves.toBeUndefined();
  expect(seen().url).toBe(`${BASE}/api/v1/admin/point-key-states/${ID}`);
  expect(seen().init.method).toBe("DELETE");
  expect(seen().init.body).toBeUndefined();
}

/** Every call carries the bearer token. */
export async function sendsTheBearerToken(): Promise<void> {
  signIn();
  try {
    const seen = stubFetch(204, null);
    await deleteAdminPointKeyState(ID);
    expect(new Headers(seen().init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** A 409 (a seeded row) is an `ApiError` keeping its status and the server's body. */
export async function a409IsAnApiErrorWithItsStatus(): Promise<void> {
  const envelope = '{"statusCode":409,"message":"A seeded state label cannot be changed","error":"Conflict"}';
  vi.stubGlobal("fetch", async () => new Response(envelope, { status: 409 }));
  const error = await caught(updateAdminPointKeyState(ID, { label: "X" }));
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).message).toBe(envelope);
}

/** A failed delete is an `ApiError` too (it does not go through `adminFetch`'s parse). */
export async function aRefusedDeleteIsAnApiError(): Promise<void> {
  vi.stubGlobal("fetch", async () => new Response('{"statusCode":404,"message":"Not found"}', { status: 404 }));
  const error = await caught(deleteAdminPointKeyState(ID));
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
}

/** A 401 on a delete clears the session it was sent with. */
export async function a401OnADeleteClearsTheSession(): Promise<void> {
  signIn();
  try {
    stubFetch(401, { message: "Unauthorized" });
    await caught(deleteAdminPointKeyState(ID));
    expect(useAuthStore.getState().accessToken).toBeNull();
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** `checkResponse` refuses a list row without `seeded` (it throws on drift under vitest). */
export async function throwsOnAnOffShapeList(): Promise<void> {
  const { seeded: _seeded, ...drifted } = ROW;
  stubFetch(200, { items: [drifted] });
  await expect(fetchAdminPointKeyStates()).rejects.toThrow();
}

/** `checkResponse` refuses a created row with a tone outside the five. */
export async function throwsOnAnOffShapeCreate(): Promise<void> {
  stubFetch(201, { ...ROW, tone: "earthed" });
  await expect(
    createAdminPointKeyState({ pointKey: ROW.pointKey, value: ROW.value, label: ROW.label, tone: ROW.tone }),
  ).rejects.toThrow();
}

/** After a write: the list key and the `/vocabularies` key the state legend reads, both. */
export async function aWriteInvalidatesTheListAndTheVocabularies(): Promise<void> {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await invalidatePointKeyStateReads(client);
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
    ["admin", "point-key-states"],
    ["vocabularies"],
  ]);
}

/** A 403 on a delete keeps the session: a refusal is not an expired token. */
export async function a403OnADeleteKeepsTheSession(): Promise<void> {
  signIn();
  try {
    stubFetch(403, { message: "Forbidden" });
    const error = await caught(deleteAdminPointKeyState(ID));
    expect((error as ApiError).status).toBe(403);
    expect(useAuthStore.getState().accessToken).toBe(TOKEN);
  } finally {
    useAuthStore.getState().clearSession();
  }
}
