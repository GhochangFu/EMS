import { expect, vi } from "vitest";

import {
  cancelMaintenanceWindow,
  createMaintenanceWindow,
  endMaintenanceWindow,
  extendMaintenanceWindow,
  fetchMaintenanceWindows,
} from "./maintenance-windows";

/**
 * `F4.359` U11 — what the maintenance-window client puts on the wire. The URL, method and body handed to
 * `fetch` are the only observable place; the consumer specs replace this module wholesale.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "00000000-0000-4000-8000-000000000001";

type Seen = { url: URL; init: RequestInit };

function capture(body: unknown): () => Seen {
  let url = "";
  let init: RequestInit = {};
  vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return () => ({ url: new URL(url), init });
}

const ITEM = {
  id: ID,
  organizationId: ORG,
  reason: "Planned service",
  startsAt: "2026-11-13T08:00:00.000Z",
  endsAt: "2026-11-13T12:00:00.000Z",
  endedAt: null,
  state: "active",
  createdByName: "Admin",
  endedByName: null,
  workOrder: null,
  maintenanceSchedule: null,
  targets: [],
  assetIds: [],
};

/** The list read: GET, the list path, `state` and the scope as query parameters. */
export async function listSendsStateAndScope(): Promise<void> {
  const seen = capture({ items: [] });
  await fetchMaintenanceWindows({ state: "active", organizationId: ORG });
  const { url, init } = seen();
  expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/maintenance-windows`);
  expect(url.searchParams.get("state")).toBe("active");
  expect(url.searchParams.get("organizationId")).toBe(ORG);
  expect(init.method ?? "GET").toBe("GET");
}

/** A key the caller leaves out is not sent. */
export async function listOmitsAbsentKeys(): Promise<void> {
  const seen = capture({ items: [] });
  await fetchMaintenanceWindows({ state: "active" });
  expect(seen().url.searchParams.has("assetId")).toBe(false);
  expect(seen().url.searchParams.has("locationId")).toBe(false);
}

/** Create POSTs the body as JSON to the collection. */
export async function createPostsTheBody(): Promise<void> {
  const seen = capture(ITEM);
  const body = {
    reason: "Planned service",
    endsAt: "2026-11-13T12:00:00.000Z",
    targets: [{ kind: "asset" as const, assetId: ID }],
  };
  await createMaintenanceWindow(body);
  const { url, init } = seen();
  expect(url.pathname).toBe("/api/v1/maintenance-windows");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual(body);
}

/** Extend, end and cancel each POST to their own sub-path of the window. */
export async function extendEndCancelHitTheirPaths(): Promise<void> {
  const seen = capture(ITEM);
  await extendMaintenanceWindow(ID, { endsAt: "2026-11-13T14:00:00.000Z" });
  expect(seen().url.pathname).toBe(`/api/v1/maintenance-windows/${ID}/extend`);
  expect(seen().init.method).toBe("POST");
  await endMaintenanceWindow(ID, { reason: "done early" });
  expect(seen().url.pathname).toBe(`/api/v1/maintenance-windows/${ID}/end`);
  expect(JSON.parse(String(seen().init.body))).toEqual({ reason: "done early" });
  await cancelMaintenanceWindow(ID);
  expect(seen().url.pathname).toBe(`/api/v1/maintenance-windows/${ID}/cancel`);
}

/** A non-OK answer throws, so a failed write is never read as success. */
export async function aFailedWriteThrows(): Promise<void> {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 403 }));
  await expect(endMaintenanceWindow(ID)).rejects.toThrow();
}
