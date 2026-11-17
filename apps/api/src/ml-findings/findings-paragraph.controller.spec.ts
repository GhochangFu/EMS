import { BadRequestException } from "@nestjs/common";
import type { JwtPayload, MlFindingsKind, MlFindingsParagraphResponse } from "@bms/shared";
import { expect } from "vitest";

import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { FindingsParagraphController } from "./findings-paragraph.controller";
import type { FindingsParagraphService } from "./findings-paragraph.service";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 10 (plan R-c, T3.4) — the paragraph
 * route: a bad `kind` or an unknown key is a 400 before `narrow`; `narrow`
 * receives exactly the four scope keys; its value reaches the service unchanged
 * (the facts service trusts the ids it is given — the E1.9a security review).
 * Assertions live here; `findings-paragraph.controller.test.ts` is the vitest
 * entry point (ADR 0014).
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASSET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Call = { kind: MlFindingsKind; assetIds: string[] | null; narrowed: boolean; now: Date };

function harness(narrowed: string[] | null = null) {
  const narrowCalls: AssetScopeFilter[] = [];
  const calls: Call[] = [];
  const answer: MlFindingsParagraphResponse = { cards: [{ organizationId: ORG, state: "pending", segments: [], assets: [] }] };
  const paragraphs = {
    get: async (kind: MlFindingsKind, assetIds: string[] | null, isNarrowed: boolean, now: Date) => {
      calls.push({ kind, assetIds, narrowed: isNarrowed, now });
      return answer;
    },
  } as unknown as FindingsParagraphService;
  const scope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      narrowCalls.push(filter);
      return narrowed;
    },
  } as unknown as AssetFilterScopeService;
  return { controller: new FindingsParagraphController(paragraphs, scope), narrowCalls, calls, answer };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

export async function aBadQueryIsA400BeforeNarrow(): Promise<void> {
  for (const query of [
    {},
    { kind: "x" },
    { kind: "forecast" },
    { kind: "anomalies", since: "2026-11-17T00:00:00Z" },
    { kind: "anomalies", organizationId: "not-a-uuid" },
    { kind: ["anomalies", "forecasts"] },
  ]) {
    const h = harness();
    const result = await settle(h.controller.get(USER, query));
    expect(result, JSON.stringify(query)).toBeInstanceOf(BadRequestException);
    expect(h.narrowCalls, `${JSON.stringify(query)}: narrow is never called`).toEqual([]);
    expect(h.calls).toEqual([]);
  }
}

export async function narrowsValueReachesTheServiceUnchanged(): Promise<void> {
  for (const value of [null, [], [ASSET]]) {
    const h = harness(value);
    const result = await h.controller.get(USER, { kind: "anomalies" });
    expect(result).toBe(h.answer);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.assetIds).toBe(value);
    expect(h.calls[0]!.kind).toBe("anomalies");
    expect(h.calls[0]!.now).toBeInstanceOf(Date);
  }
}

export async function narrowReceivesExactlyTheScopeKeys(): Promise<void> {
  const h = harness([ASSET]);
  await h.controller.get(USER, { kind: "forecasts", organizationId: ORG, locationId: LOC, assetGroupId: GROUP, assetId: ASSET });
  expect(h.narrowCalls).toEqual([{ organizationId: ORG, locationId: LOC, assetGroupId: GROUP, assetId: ASSET }]);
  expect(h.calls[0]).toMatchObject({ kind: "forecasts", narrowed: true });
  const org = harness();
  await org.controller.get(USER, { kind: "forecasts", organizationId: ORG });
  expect(org.narrowCalls).toEqual([{ organizationId: ORG }]);
  expect(org.calls[0]?.narrowed, "an organization alone does not narrow (R-r)").toBe(false);
  const none = harness();
  await none.controller.get(USER, { kind: "anomalies" });
  expect(none.narrowCalls).toEqual([{}]);
}
