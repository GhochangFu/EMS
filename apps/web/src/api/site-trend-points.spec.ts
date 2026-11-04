import type { SiteTrendPointsDto } from "@bms/shared";
import { expect, vi } from "vitest";

import { fetchSiteTrendPoints } from "./site-trend-points";
import { ResponseContractError } from "./validate";

/**
 * `F4.306` PR 2 U10 (ADR 0108 Amendment 7) — the site trend-points client the wizard and the
 * builder's selection summary read: `GET /control-room/sites/:locationId/trend-points`, checked
 * against `siteTrendPointsDtoSchema`. `node` environment, as `energy-view.spec.ts`.
 *
 * Assertions live here; `site-trend-points.test.ts` is the Vitest entry point (ADR 0014).
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const LISTS: SiteTrendPointsDto = {
  locationId: LOCATION_ID,
  organizationId: ORG,
  segments: [
    {
      domain: "seg_a",
      label: "Segment A",
      source: "catalog",
      points: [{ code: "pt_x", name: "Point X", unit: "kW", active: true }],
      catalogDefaults: [],
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

/** Captures the one request's URL and init, and answers with `answer` at `status`. Per-call state. */
function captureRequest(answer: unknown, status = 200): () => { url: string; init: RequestInit | undefined } {
  let seen: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(answer), { status });
  });
  return () => seen;
}

/** The read goes to the site's trend-points route, with the location id in the path, as a GET. */
export async function readsTheSiteTrendPointsRoute(): Promise<void> {
  const seen = captureRequest(LISTS);
  await fetchSiteTrendPoints(LOCATION_ID);
  expect(seen().url).toBe(`${BASE}/api/v1/control-room/sites/${LOCATION_ID}/trend-points`);
  expect(seen().init?.method ?? "GET").toBe("GET");
}

/** The answer is the parsed DTO: the segment and its points arrive unchanged. */
export async function answersTheParsedLists(): Promise<void> {
  captureRequest(LISTS);
  const lists = await fetchSiteTrendPoints(LOCATION_ID);
  expect(lists).toEqual(LISTS);
}

/** A body without `segments` is not the contract and is refused. */
export async function refusesABodyWithoutSegments(): Promise<void> {
  captureRequest({ locationId: LOCATION_ID, organizationId: ORG });
  await expect(fetchSiteTrendPoints(LOCATION_ID)).rejects.toBeInstanceOf(ResponseContractError);
}

/** A non-OK status throws an error that names the route and the status, never the body. */
export async function throwsOnANonOkStatus(): Promise<void> {
  captureRequest({ message: "secret detail" }, 404);
  await expect(fetchSiteTrendPoints(LOCATION_ID)).rejects.toThrow("control-room/sites/:id/trend-points 404");
}
