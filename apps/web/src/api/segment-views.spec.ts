import { expect, vi } from "vitest";

import { ApiError } from "../lib/api-error";
import * as http from "./http";
import { fetchSiteSegmentViews, isSegmentNotFound, segmentViewsQueryKey } from "./segment-views";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 4) — the segment-views client reaches the route with the
 * query's keys, throws a status-carrying error on a non-OK answer after clearing a refused
 * session, and checks the body against `siteSegmentViewsSchema`. `node` environment, as
 * `energy-view.spec.ts`. Entry point: `segment-views.test.ts`.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const SITE = "11111111-1111-4111-8111-111111111111";

export const SEGMENT_VIEWS_BODY = {
  locationId: SITE,
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-10-31T00:00:00.000Z",
  level: "5m",
  bucket: "5m",
  current: { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T23:59:59.999Z", durationHours: 24 },
  compare: null,
  segments: [{ domain: "chillers", label: "Chillers", assetCount: 2 }],
  segment: { domain: "chillers", label: "Chillers", source: "catalog" },
  points: [{ code: "kw", name: "Power", unit: "kW" }],
  point: { code: "kw", name: "Power", unit: "kW" },
  ranking: [],
  moreAssets: 0,
  seriesCount: 0,
  trimmed: false,
  abnormal: {
    baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5, belowRatio: 0.5, nearZeroFraction: 0.01 },
    entries: [],
    normalCount: 0,
    truncated: false,
  },
};

function stubFetch(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** The path names the site; the search carries the query's keys in order and no absent one. */
export async function fetchesTheRouteWithTheQueryKeys(): Promise<void> {
  const seen = stubFetch(SEGMENT_VIEWS_BODY);
  const view = await fetchSiteSegmentViews(SITE, {
    range: "custom",
    segment: "chillers",
    point: "kw",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
    compare: "previous",
  });
  const url = new URL(seen());
  expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/control-room/sites/${SITE}/segment-views`);
  expect([...url.searchParams.entries()]).toEqual([
    ["range", "custom"],
    ["segment", "chillers"],
    ["point", "kw"],
    ["from", "2026-10-01T00:00:00.000Z"],
    ["to", "2026-10-02T00:00:00.000Z"],
    ["compare", "previous"],
  ]);
  expect(view.timeZone).toBe("Asia/Kolkata");
}

/** A bare query sends the range only. */
export async function sendsNoAbsentKey(): Promise<void> {
  const seen = stubFetch(SEGMENT_VIEWS_BODY);
  await fetchSiteSegmentViews(SITE, { range: "24h" });
  expect([...new URL(seen()).searchParams.keys()]).toEqual(["range"]);
}

/** The query key names the site and the whole query. */
export function theQueryKeyNamesTheSiteAndTheQuery(): void {
  expect(segmentViewsQueryKey(SITE, { range: "7d", segment: "chillers" })).toEqual([
    "control-room",
    "segment-views",
    SITE,
    { range: "7d", segment: "chillers" },
  ]);
}

/** A non-OK answer clears a refused session and throws an `ApiError` with the status. */
export async function aNonOkAnswerClearsTheSessionAndThrows(): Promise<void> {
  stubFetch({ message: "Not Found" }, 404);
  const clear = vi.spyOn(http, "clearSessionOnAuthFailure").mockImplementation(() => undefined);
  const error = await fetchSiteSegmentViews(SITE, { range: "24h" }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(isSegmentNotFound(error)).toBe(true);
}

/** Only a 404 is "not found"; a 500 and a plain error are not. */
export function onlyA404IsNotFound(): void {
  expect(isSegmentNotFound(new ApiError("x", 500))).toBe(false);
  expect(isSegmentNotFound(new Error("x 404"))).toBe(false);
}

/** A body outside the contract is refused (a fifth verdict). */
export async function refusesABodyOutsideTheContract(): Promise<void> {
  stubFetch({
    ...SEGMENT_VIEWS_BODY,
    abnormal: {
      ...SEGMENT_VIEWS_BODY.abnormal,
      entries: [
        {
          assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          assetCode: "A1",
          assetName: "A1",
          unit: null,
          currentMean: 1,
          baselineMean: 1,
          ratio: 1,
          verdict: "normal",
          baselineWindows: 4,
        },
      ],
    },
  });
  await expect(fetchSiteSegmentViews(SITE, { range: "24h" })).rejects.toThrow();
}
