import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { AdvisoriesResponse, JwtPayload } from "@bms/shared";
import { expect } from "vitest";

import type { AccessControlService } from "../auth/access-control.service";
import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { AdvisoriesController } from "./advisories.controller";
import type { AdvisoriesService } from "./advisories.service";

/**
 * `E1.6a` / ADR 0137 decision 6 (plan T1.6, Q3) — the two routes. `list`: the
 * query (400) before `narrow`, `narrow` gets exactly the parsed keys, its value
 * reaches the service unchanged with one clock. `forAsset`: the id (400), then
 * `canReadAsset` (403), then the service with that one id. Assertions live
 * here; `advisories.controller.test.ts` is the vitest entry point (ADR 0014).
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ORG = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const LOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Call = { route: "list" | "forAsset"; arg: string[] | null | string; now: Date };

function harness(narrowed: string[] | null = null, canRead = true) {
  const order: string[] = [];
  const narrowCalls: AssetScopeFilter[] = [];
  const readChecks: string[] = [];
  const calls: Call[] = [];
  const answer = (now: Date): AdvisoriesResponse => ({ asOf: now.toISOString(), candidates: 0, considered: 0, advisories: [] });
  const service = {
    list: async (assetIds: string[] | null, now: Date) => {
      order.push("service");
      calls.push({ route: "list", arg: assetIds, now });
      return answer(now);
    },
    forAsset: async (assetId: string, now: Date) => {
      order.push("service");
      calls.push({ route: "forAsset", arg: assetId, now });
      return answer(now);
    },
  } as unknown as AdvisoriesService;
  const scope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      order.push("narrow");
      narrowCalls.push(filter);
      return narrowed;
    },
  } as unknown as AssetFilterScopeService;
  const access = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      order.push("canReadAsset");
      readChecks.push(assetId);
      return canRead;
    },
  } as unknown as AccessControlService;
  return { controller: new AdvisoriesController(service, scope, access), order, narrowCalls, readChecks, calls };
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
    expect(body).toEqual({ asOf: h.calls[0]?.now.toISOString(), candidates: 0, considered: 0, advisories: [] });
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

/** `forAsset`: a non-UUID is 400 before any check; outside scope is 403 before the service; else the service with that id. */
export async function forAssetChecksTheIdThenTheScopeThenReads(): Promise<void> {
  const bad = harness();
  expect(await settle(bad.controller.forAsset(USER, "not-a-uuid"))).toBeInstanceOf(BadRequestException);
  expect(bad.order).toEqual([]);

  const denied = harness(null, false);
  expect(await settle(denied.controller.forAsset(USER, ASSET))).toBeInstanceOf(ForbiddenException);
  expect(denied.order).toEqual(["canReadAsset"]);
  expect(denied.calls).toEqual([]);

  const ok = harness(null, true);
  const before = Date.now();
  const body = await ok.controller.forAsset(USER, ASSET);
  expect(ok.order).toEqual(["canReadAsset", "service"]);
  expect(ok.readChecks).toEqual([ASSET]);
  expect(ok.calls[0]?.arg).toBe(ASSET);
  expect(ok.calls[0]?.now.getTime()).toBeGreaterThanOrEqual(before);
  expect(body.asOf).toBe(ok.calls[0]?.now.toISOString());
}
