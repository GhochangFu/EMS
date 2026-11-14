import { expect, vi } from "vitest";

import { fetchFilterOptions, filterOptionsQueryKey } from "./filter-options";

/**
 * `F4.361` U6 (ADR 0132 decision 2) — what the filter-options client puts on the wire and what it
 * accepts. The consumer specs replace `fetchFilterOptions` with a spy, so the URL handed to `fetch`
 * and the contract check are only observable here.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const EMPTY = { organizations: [], locations: [], assetGroups: [], assets: [] };

function capture(body: unknown, status = 200): () => URL {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify(body), { status });
  });
  return () => new URL(url);
}

/** One GET of `/api/v1/filter-options`, no query string. */
export async function readsTheOptionsPath(): Promise<void> {
  const seen = capture(EMPTY);
  await expect(fetchFilterOptions()).resolves.toEqual(EMPTY);
  expect(`${seen().origin}${seen().pathname}`).toBe(`${BASE}/api/v1/filter-options`);
  expect(seen().search).toBe("");
  expect(filterOptionsQueryKey).toEqual(["filter-options"]);
}

/** A refused read throws, so the hook reports the pickers unavailable. */
export async function aRefusedReadThrows(): Promise<void> {
  capture({ message: "nope" }, 500);
  await expect(fetchFilterOptions()).rejects.toThrow("filter-options 500");
}

/** A payload that breaks the contract (a group without `assetIds`) throws outside production (ADR 0030). */
export async function aDriftedPayloadThrows(): Promise<void> {
  capture({
    ...EMPTY,
    assetGroups: [{ id: "g", name: "G", code: "G", locationId: "l", organizationId: "o" }],
  });
  await expect(fetchFilterOptions()).rejects.toThrow();
}
