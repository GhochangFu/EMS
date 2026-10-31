import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { ReportsController } from "./reports.controller";

/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — the four energy routes thread the
 * query's `locationIds` to `ReportScopeService.assetIdsForCaller` and its
 * answer to the renderer as the asset scope. Fakes with call logs; the
 * resolution itself is `report-scope.spec.ts`'s. Vitest entry point: the
 * sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const SITE = "40000000-0000-4000-8000-000000000001";
const SCOPED = ["30000000-0000-4000-8000-000000000001"];
const RANGE = { startDate: "2026-09-01", endDate: "2026-09-07" };

type Route = "energyPreview" | "energyCsv" | "energyXlsx" | "energyPdf";

function harness() {
  const scopeCalls: Array<readonly string[] | undefined> = [];
  const renderCalls: unknown[][] = [];
  const render = async (dto: unknown, ids: unknown) => {
    renderCalls.push([dto, ids]);
    return Buffer.from("x");
  };
  const controller = new ReportsController(
    { energyPreview: render, energyCsv: render, energyXlsx: render, energyPdf: render } as never,
    {
      assetIdsForCaller: async (_user: JwtPayload, locationIds: readonly string[] | undefined) => {
        scopeCalls.push(locationIds);
        return SCOPED;
      },
    } as never,
  );
  const res = { setHeader: () => undefined, send: () => undefined };
  const call = (route: Route, query: unknown) =>
    route === "energyXlsx" || route === "energyPdf" ? controller[route](USER, query, res as never) : controller[route](USER, query);
  return { call, scopeCalls, renderCalls };
}

/** The route hands the query's site ids to the scope service. */
export async function theRoutePassesTheLocationIdsToTheScope(route: Route): Promise<void> {
  const h = harness();
  await h.call(route, { ...RANGE, locationIds: [SITE] });
  expect(h.scopeCalls).toEqual([[SITE]]);
}

/** One bare `?locationIds=` reaches the scope service folded into a list. */
export async function aBareLocationIdReachesTheScopeAsAList(route: Route): Promise<void> {
  const h = harness();
  await h.call(route, { ...RANGE, locationIds: SITE });
  expect(h.scopeCalls).toEqual([[SITE]]);
}

/** A query without `locationIds` asks the scope service for the unfiltered read (`undefined`). */
export async function noLocationIdsAsksForTheUnfilteredScope(route: Route): Promise<void> {
  const h = harness();
  await h.call(route, RANGE);
  expect(h.scopeCalls).toEqual([undefined]);
}

/** The scope service's answer is the renderer's asset scope. */
export async function theScopesAnswerIsTheRenderersAssetScope(route: Route): Promise<void> {
  const h = harness();
  await h.call(route, { ...RANGE, locationIds: [SITE] });
  expect(h.renderCalls[0]?.[1]).toBe(SCOPED);
}
