import { expect, vi } from "vitest";

import { encodePointRef } from "@bms/shared";

import { fetchPointValuesAt } from "./telemetry";

/**
 * `F3.28` task 2.6 — what `fetchPointValuesAt` puts on the wire, and that it
 * parses the response through the shared schema.
 *
 * `node` environment, like `alarms.spec.ts`: importing a module that reads
 * `import.meta.env` at module scope is fine under the web project's config.
 */

const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

/** `encodePointRef` output — its separator (`::`) is exactly what
 * `encodeURIComponent` must escape, so this ref exercises the round trip the
 * client's URL-building has to get right. */
const REF_A = encodePointRef(ASSET_A, "kw");
const REF_B = encodePointRef(ASSET_B, "backup_min");

const AT = "2026-09-23T10:00:00.000Z";

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** Captures the URL of the single request the call makes and answers with
 * `body`, which must pass the fetcher's `checkResponse`. */
function captureUrl(body: unknown): () => URL {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return () => new URL(seen);
}

const RESPONSE = {
  at: AT,
  items: [
    { pointRef: REF_A, time: AT, value: 42, unit: "kW" },
    { pointRef: REF_B, time: null, value: null, unit: null },
  ],
};

/** The read goes to the at-instant path. */
export async function hitsTheAtInstantPath(): Promise<void> {
  const seen = captureUrl(RESPONSE);
  await fetchPointValuesAt([REF_A, REF_B], AT);
  expect(`${seen().origin}${seen().pathname}`).toBe(`${BASE}/api/v1/telemetry/points/at-instant`);
}

/** `at` is sent verbatim. */
export async function sendsAtVerbatim(): Promise<void> {
  const seen = captureUrl(RESPONSE);
  await fetchPointValuesAt([REF_A], AT);
  expect(seen().searchParams.get("at")).toBe(AT);
}

/**
 * One `refs` per ref, in order, and — the load-bearing claim — each ref
 * round-trips through `URLSearchParams` back to the exact string
 * `encodePointRef` produced. A ref whose separator needs encoding (`::` →
 * `%3A%3A`) is what would expose a single- or triple-encoding mistake: reading
 * the raw query string here (rather than `URLSearchParams.getAll`, which
 * itself decodes once and would hide a wrong encoding depth) pins the exact
 * bytes sent on the wire.
 */
export async function sendsOneRefsPerRefRoundTripping(): Promise<void> {
  const seen = captureUrl(RESPONSE);
  await fetchPointValuesAt([REF_A, REF_B], AT);
  const url = seen();
  expect(url.search).toBe(
    `?at=${encodeURIComponent(AT)}&refs=${encodeURIComponent(REF_A)}&refs=${encodeURIComponent(REF_B)}`,
  );
  expect(url.searchParams.getAll("refs")).toEqual([REF_A, REF_B]);
}

/** The response parses through the shared schema, and the parsed shape is
 * returned to the caller unchanged. */
export async function parsesTheResponseThroughTheSharedSchema(): Promise<void> {
  captureUrl(RESPONSE);
  const result = await fetchPointValuesAt([REF_A, REF_B], AT);
  expect(result).toEqual(RESPONSE);
}

/** A non-2xx response throws rather than returning a parsed body. */
export async function throwsOnANon2xxResponse(): Promise<void> {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 403 }));
  await expect(fetchPointValuesAt([REF_A], AT)).rejects.toThrow();
}
