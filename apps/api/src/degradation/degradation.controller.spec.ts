import { BadRequestException } from "@nestjs/common";
import type { DegradationResponse, JwtPayload } from "@bms/shared";
import { expect } from "vitest";

import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { DegradationController } from "./degradation.controller";
import type { DegradationService } from "./degradation.service";

/**
 * `E1.5a` / ADR 0138 (plan T1.7, T1.8, §4.1) — the two routes. `list`: the
 * query (400) before `narrow`, `narrow` gets exactly the parsed keys, its value
 * reaches the service unchanged with one clock. Assertions live here; `degradation.controller.test.ts` is the vitest entry point (ADR 0014).
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ORG = "D0D0D0D0-0000-4000-8000-000000000001";
const LOC = "d1d1d1d1-0000-4000-8000-000000000001";
const ASSET = "aaaaaaaa-0000-4000-8000-000000000001";

type Call = { route: "list"; arg: string[] | null; now: Date };

function harness(narrowed: string[] | null = null) {
  const order: string[] = [];
  const narrowCalls: AssetScopeFilter[] = [];
  const calls: Call[] = [];
  const answer = (now: Date): DegradationResponse => ({ asOf: now.toISOString(), candidates: 0, considered: 0, assets: [] });
  const service = {
    list: async (assetIds: string[] | null, now: Date) => {
      order.push("service");
      calls.push({ route: "list", arg: assetIds, now });
      return answer(now);
    },
  } as unknown as DegradationService;
  const scope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      order.push("narrow");
      narrowCalls.push(filter);
      return narrowed;
    },
  } as unknown as AssetFilterScopeService;
  return { controller: new DegradationController(service, scope), order, narrowCalls, calls };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

/** `narrow`'s value — an array, `[]` or `null` — reaches the service unchanged, with one clock. */
export async function listHandsNarrowsValueToTheService(): Promise<void> {
  for (const narrowed of [null, [], [ASSET]]) {
    const h = harness(narrowed);
    const before = Date.now();
    const body = await h.controller.list(USER, {});
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.route).toBe("list");
    expect(h.calls[0]?.arg).toBe(narrowed);
    expect(h.calls[0]?.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(body).toEqual({ asOf: h.calls[0]?.now.toISOString(), candidates: 0, considered: 0, assets: [] });
    expect(h.order).toEqual(["narrow", "service"]);
  }
}

/** `narrow` receives exactly the parsed keys: lower-cased, and nothing else. */
export async function narrowGetsExactlyTheParsedKeys(): Promise<void> {
  const h = harness([ASSET]);
  await h.controller.list(USER, { organizationId: ORG, locationId: LOC });
  expect(h.narrowCalls).toEqual([{ organizationId: ORG.toLowerCase(), locationId: LOC }]);
  const none = harness();
  await none.controller.list(USER, {});
  expect(none.narrowCalls).toEqual([{}]);
}

/** A bad query is a 400 and neither `narrow` nor the service is called. */
export async function aBadQueryIs400BeforeNarrow(): Promise<void> {
  for (const query of [{ assetGroupId: LOC }, { organizationId: "nope" }, { unknown: "1" }]) {
    const h = harness();
    const err = await settle(h.controller.list(USER, query));
    expect(err, JSON.stringify(query)).toBeInstanceOf(BadRequestException);
    expect(h.order).toEqual([]);
  }
}
