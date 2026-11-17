import { BadRequestException } from "@nestjs/common";
import type { JwtPayload, MlFindingsSummaryResponse } from "@bms/shared";
import { expect } from "vitest";

import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { MlFindingsController } from "./ml-findings.controller";
import type { MlFindingsService } from "./ml-findings.service";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decisions 8 and 10 (plan R-b, R-c, R-r, T1.3)
 * — the two summary routes: the query is parsed (400) before `narrow`, `narrow`
 * receives exactly the parsed keys, its value reaches the service unchanged, and
 * the answer is the service's. Assertions live here;
 * `ml-findings.controller.test.ts` is the vitest entry point (ADR 0014).
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ORG = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const LOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASSET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Call = { kind: "forecasts" | "anomalies"; assetIds: string[] | null; narrowed: boolean; now: Date };

function harness(narrowed: string[] | null = null) {
  const narrowCalls: AssetScopeFilter[] = [];
  const calls: Call[] = [];
  const answer = (kind: Call["kind"]) => async (assetIds: string[] | null, isNarrowed: boolean, now: Date) => {
    calls.push({ kind, assetIds, narrowed: isNarrowed, now });
    const body: MlFindingsSummaryResponse = { asOf: now.toISOString(), cards: [] };
    return body;
  };
  const findings = {
    forecastSummary: answer("forecasts"),
    anomalySummary: answer("anomalies"),
  } as unknown as MlFindingsService;
  const scope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      narrowCalls.push(filter);
      return narrowed;
    },
  } as unknown as AssetFilterScopeService;
  return { controller: new MlFindingsController(findings, scope), narrowCalls, calls };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

const routes = ["forecastSummary", "anomalySummary"] as const;
const kindOf = { forecastSummary: "forecasts", anomalySummary: "anomalies" } as const;

/** `narrow`'s value — an array, `[]` or `null` — reaches the service unchanged, with one clock; the answer is the service's. */
export async function bothRoutesHandNarrowsValueToTheService(): Promise<void> {
  for (const route of routes) {
    for (const narrowed of [null, [], [ASSET]]) {
      const h = harness(narrowed);
      const before = Date.now();
      const body = await h.controller[route](USER, {});
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]?.kind).toBe(kindOf[route]);
      expect(h.calls[0]?.assetIds, route).toBe(narrowed);
      expect(h.calls[0]?.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(body).toEqual({ asOf: h.calls[0]?.now.toISOString(), cards: [] });
    }
  }
}

/** `narrow` receives exactly the parsed keys; `narrowed` is true for a location, group or asset, not an organization (R-r). */
export async function narrowGetsTheParsedKeysAndNarrowedFollowsThem(): Promise<void> {
  for (const route of routes) {
    const all = { organizationId: ORG, locationId: LOC, assetGroupId: GROUP, assetId: ASSET };
    const h = harness([ASSET]);
    await h.controller[route](USER, all);
    expect(h.narrowCalls).toEqual([{ ...all, organizationId: ORG.toLowerCase() }]);
    expect(h.calls[0]?.narrowed).toBe(true);
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{}, false],
      [{ organizationId: ORG }, false],
      [{ locationId: LOC }, true],
      [{ assetGroupId: GROUP }, true],
      [{ assetId: ASSET }, true],
    ];
    for (const [query, expected] of cases) {
      const one = harness();
      await one.controller[route](USER, query);
      expect(one.calls[0]?.narrowed, `${route} ${JSON.stringify(query)}`).toBe(expected);
    }
  }
}

/** A bad query is a 400; `narrow` and the service never run. */
export async function aBadQueryIsA400BeforeNarrow(): Promise<void> {
  for (const route of routes) {
    for (const query of [{ organizationId: "x" }, { kind: "forecasts" }, { since: "2026-11-15T00:00:00Z" }]) {
      const h = harness();
      expect(await settle(h.controller[route](USER, query)), JSON.stringify(query)).toBeInstanceOf(BadRequestException);
      expect(h.narrowCalls).toEqual([]);
      expect(h.calls).toEqual([]);
    }
  }
}
