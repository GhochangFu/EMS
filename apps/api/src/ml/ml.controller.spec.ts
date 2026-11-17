import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { encodePointRef, type JwtPayload } from "@bms/shared";
import { expect } from "vitest";

import type { AccessControlService } from "../auth/access-control.service";
import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { MlController } from "./ml.controller";
import type { MlAnomaliesService } from "./ml-anomalies.service";
import type { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c, S1, S2, S4 — the `ml` routes' order of
 * refusals and what reaches the service, with `AccessControlService` and the
 * service stubbed. Assertions live here; `ml.controller.test.ts` is the vitest
 * entry point (ADR 0014). Plan §5, T1.9; §16 security 6.
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ASSET = "88888888-8888-4888-8888-888888888888";

/** The route param as Express hands it over: `encodePointRef`'s output, URL-decoded once. */
const param = (assetId: string, pointKey: string): string => decodeURIComponent(encodePointRef(assetId, pointKey));

type Harness = {
  controller: MlController;
  canReadCalls: string[];
  currentCalls: { point: { assetId: string; pointKey: string }; now: Date }[];
  listCalls: { assetIds: string[] | null; now: Date }[];
  pastCalls: { point: { assetId: string; pointKey: string }; window: { from: Date; to: Date }; now: Date }[];
  /** `E1.2b`: the anomaly service's calls. */
  forAssetCalls: { assetId: string; window: { from: Date; to: Date }; now: Date }[];
  anomalyListCalls: { assetIds: string[] | null; since: Date | undefined; now: Date }[];
  /** `E1.9a`: the filter each `narrow` call received. */
  narrowCalls: AssetScopeFilter[];
};

function harness(opts: { canRead?: boolean; readable?: string[] | null; narrowed?: string[] | null } = {}): Harness {
  const canReadCalls: string[] = [];
  const currentCalls: Harness["currentCalls"] = [];
  const listCalls: Harness["listCalls"] = [];
  const pastCalls: Harness["pastCalls"] = [];
  const forAssetCalls: Harness["forAssetCalls"] = [];
  const anomalyListCalls: Harness["anomalyListCalls"] = [];
  const narrowCalls: AssetScopeFilter[] = [];
  const accessControl = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      canReadCalls.push(assetId);
      return opts.canRead ?? true;
    },
    readableAssetIds: async () => (opts.readable === undefined ? null : opts.readable),
  } as unknown as AccessControlService;
  const service = {
    current: async (point: { assetId: string; pointKey: string }, now: Date) => {
      currentCalls.push({ point, now });
      return { asOf: now.toISOString(), forecast: null };
    },
    list: async (assetIds: string[] | null, now: Date) => {
      listCalls.push({ assetIds, now });
      return { items: [] };
    },
    past: async (point: { assetId: string; pointKey: string }, window: { from: Date; to: Date }, now: Date) => {
      pastCalls.push({ point, window, now });
      return { asOf: now.toISOString(), buckets: [] };
    },
  } as unknown as MlForecastsService;
  const anomalyService = {
    forAsset: async (assetId: string, window: { from: Date; to: Date }, now: Date) => {
      forAssetCalls.push({ assetId, window, now });
      return { asOf: now.toISOString(), scores: [] };
    },
    list: async (assetIds: string[] | null, since: Date | undefined, now: Date) => {
      anomalyListCalls.push({ assetIds, since, now });
      return { asOf: now.toISOString(), since: now.toISOString(), truncated: false, items: [] };
    },
  } as unknown as MlAnomaliesService;
  // `E1.9a`: the stub hands back `narrowed` (default: the readable ids), so a handler that read
  // `readableAssetIds` itself instead of `narrow`'s value is told apart.
  const assetFilterScope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      narrowCalls.push(filter);
      return opts.narrowed === undefined ? (opts.readable === undefined ? null : opts.readable) : opts.narrowed;
    },
  } as unknown as AssetFilterScopeService;
  return {
    controller: new MlController(service, accessControl, anomalyService, assetFilterScope),
    canReadCalls,
    currentCalls,
    listCalls,
    pastCalls,
    forAssetCalls,
    anomalyListCalls,
    narrowCalls,
  };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

export async function aBadRefIsA400BeforeTheScopeCheckOrTheService(): Promise<void> {
  for (const bad of ["no-separator", param("not-a-uuid", "kw"), param(ASSET, ""), param(ASSET, "k".repeat(129))]) {
    const h = harness();
    const err = await settle(h.controller.pointForecast(USER, bad));
    expect(err, bad.slice(0, 40)).toBeInstanceOf(BadRequestException);
    expect(h.canReadCalls, "canReadAsset must not run on a 400").toEqual([]);
    expect(h.currentCalls, "the service must not run on a 400").toEqual([]);
  }
}

export async function aForeignAssetIsA403BeforeTheService(): Promise<void> {
  const h = harness({ canRead: false });
  const err = await settle(h.controller.pointForecast(USER, param(ASSET, "temp_c")));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.currentCalls).toEqual([]);
}

export async function theServiceReceivesTheDecodedPairAndOneClock(): Promise<void> {
  const h = harness();
  const before = Date.now();
  const body = await h.controller.pointForecast(USER, param(ASSET, "temp c/1"));
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.currentCalls).toHaveLength(1);
  expect(h.currentCalls[0]?.point).toEqual({ assetId: ASSET, pointKey: "temp c/1" });
  const now = h.currentCalls[0]?.now as Date;
  expect(now).toBeInstanceOf(Date);
  expect(now.getTime()).toBeGreaterThanOrEqual(before);
  expect(body).toEqual({ asOf: now.toISOString(), forecast: null });
}

export async function theListHandsReadableAssetIdsToTheServiceUnchanged(): Promise<void> {
  for (const narrowed of [null, [], [ASSET, "99999999-9999-4999-8999-999999999999"]]) {
    // `readable` differs from `narrowed`: only `narrow`'s value may reach the service.
    const h = harness({ readable: ["77777777-7777-4777-8777-777777777777"], narrowed });
    await h.controller.list(USER, {});
    expect(h.listCalls).toHaveLength(1);
    expect(h.listCalls[0]?.assetIds).toBe(narrowed);
    expect(h.listCalls[0]?.now).toBeInstanceOf(Date);
    expect(h.narrowCalls).toEqual([{}]);
  }
}

const ORG = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const LOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** `E1.9a` (Amendment 8 decision 8): `narrow` receives exactly the parsed keys; a bad query is a 400 before it. */
export async function theListNarrowsByTheParsedFilter(): Promise<void> {
  const h = harness({ narrowed: [ASSET] });
  await h.controller.list(USER, { organizationId: ORG, locationId: LOC });
  expect(h.narrowCalls).toEqual([{ organizationId: ORG.toLowerCase(), locationId: LOC }]);
  expect(h.listCalls[0]?.assetIds).toEqual([ASSET]);
  for (const query of [{ assetGroupId: LOC }, { organizationId: "x" }, { since: "2026-11-15T00:00:00Z" }]) {
    const bad = harness();
    expect(await settle(bad.controller.list(USER, query)), JSON.stringify(query)).toBeInstanceOf(BadRequestException);
    expect(bad.narrowCalls, "narrow must not run on a 400").toEqual([]);
    expect(bad.listCalls).toEqual([]);
  }
}

/** `E1.9a`: the anomaly list narrows by its two keys, never `since`, and hands `narrow`'s value on. */
export async function theAnomalyListNarrowsByTheParsedFilter(): Promise<void> {
  const h = harness({ narrowed: [] });
  await h.controller.anomalies(USER, { since: "2026-11-15T00:00:00Z", organizationId: ORG, locationId: LOC });
  expect(h.narrowCalls).toEqual([{ organizationId: ORG.toLowerCase(), locationId: LOC }]);
  expect(h.anomalyListCalls[0]?.assetIds).toEqual([]);
  const bad = harness();
  expect(await settle(bad.controller.anomalies(USER, { assetId: ASSET }))).toBeInstanceOf(BadRequestException);
  expect(bad.narrowCalls).toEqual([]);
}

const FROM = "2026-11-15T00:00:00.000Z";
const TO = "2026-11-16T00:00:00.000Z";

/** `E1.4e`: a bad ref is a 400 before the query is even looked at, the scope check or the service. */
export async function thePastRouteRefusesABadRefFirst(): Promise<void> {
  for (const bad of ["no-separator", param("not-a-uuid", "kw"), param(ASSET, ""), param(ASSET, "k".repeat(129))]) {
    const h = harness();
    // The query is bad too: the ref's 400 must be the one raised (decode first).
    const err = await settle(h.controller.pastForecast(USER, bad, { window: "24h" }));
    expect(err, bad.slice(0, 40)).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message, "the ref's refusal, not the query's").toMatch(/point/i);
    expect(h.canReadCalls).toEqual([]);
    expect(h.pastCalls).toEqual([]);
  }
}

/** `E1.4e`: a missing, garbled, reversed or over-long window, or an extra key, is a 400 before canReadAsset. */
export async function thePastRouteRefusesABadWindowBeforeTheScopeCheck(): Promise<void> {
  const bad: Record<string, unknown>[] = [
    {},
    { from: FROM },
    { to: TO },
    { from: "last-tuesday", to: TO },
    { from: TO, to: FROM },
    { from: "2024-01-01T00:00:00.000Z", to: TO },
    { from: FROM, to: TO, extra: "1" },
  ];
  for (const query of bad) {
    const h = harness();
    const err = await settle(h.controller.pastForecast(USER, param(ASSET, "temp_c"), query));
    expect(err, JSON.stringify(query)).toBeInstanceOf(BadRequestException);
    expect(h.canReadCalls, "canReadAsset must not run on a 400").toEqual([]);
    expect(h.pastCalls).toEqual([]);
  }
  const reversed = await settle(harness().controller.pastForecast(USER, param(ASSET, "temp_c"), { from: TO, to: FROM }));
  expect((reversed as BadRequestException).message).toBe("from must be earlier than to");
}

/** `E1.4e`: a foreign asset is a 403 before the read. */
export async function thePastRouteIsA403BeforeTheService(): Promise<void> {
  const h = harness({ canRead: false });
  const err = await settle(h.controller.pastForecast(USER, param(ASSET, "temp_c"), { from: FROM, to: TO }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.pastCalls).toEqual([]);
}

/** `E1.4e`: the decoded pair, the parsed window as instants and one clock reach the service. */
export async function thePastRouteHandsTheDecodedPairAndWindowToTheService(): Promise<void> {
  const h = harness();
  const before = Date.now();
  const body = await h.controller.pastForecast(USER, param(ASSET, "temp c/1"), {
    from: "2026-11-15T05:30:00+05:30",
    to: TO,
  });
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.pastCalls).toHaveLength(1);
  const call = h.pastCalls[0];
  expect(call?.point).toEqual({ assetId: ASSET, pointKey: "temp c/1" });
  expect(call?.window.from.toISOString()).toBe(FROM);
  expect(call?.window.to.toISOString()).toBe(TO);
  expect(call?.now.getTime()).toBeGreaterThanOrEqual(before);
  expect(body).toEqual({ asOf: call?.now.toISOString(), buckets: [] });
}

/** `E1.2b` (ADR 0135 Amendment 5 A-e): a non-UUID asset id is a 400 before the query, canReadAsset or the service. */
export async function theAnomalyRouteRefusesANonUuidIdFirst(): Promise<void> {
  for (const bad of ["not-a-uuid", "", `${ASSET}x`, `${ASSET},${ASSET}`]) {
    const h = harness();
    // The query is bad too: the id's 400 must be the one raised.
    const err = await settle(h.controller.assetAnomalies(USER, bad, { window: "24h" }));
    expect(err, JSON.stringify(bad)).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message, "the id's refusal, not the query's").toMatch(/asset id/i);
    expect(h.canReadCalls, "canReadAsset must not run on a 400").toEqual([]);
    expect(h.forAssetCalls).toEqual([]);
  }
}

/** `E1.2b`: a bad window or an unknown key is a 400 before canReadAsset. */
export async function theAnomalyRouteRefusesABadWindowBeforeTheScopeCheck(): Promise<void> {
  const bad: Record<string, unknown>[] = [
    {},
    { from: FROM },
    { from: "last-tuesday", to: TO },
    { from: TO, to: FROM },
    { from: "2026-10-01T00:00:00.000Z", to: TO },
    { from: FROM, to: TO, fn: "max" },
  ];
  for (const query of bad) {
    const h = harness();
    const err = await settle(h.controller.assetAnomalies(USER, ASSET, query));
    expect(err, JSON.stringify(query)).toBeInstanceOf(BadRequestException);
    expect(h.canReadCalls, "canReadAsset must not run on a 400").toEqual([]);
    expect(h.forAssetCalls).toEqual([]);
  }
}

/** `E1.2b`: a foreign asset is a 403 before the read. */
export async function theAnomalyRouteIsA403BeforeTheService(): Promise<void> {
  const h = harness({ canRead: false });
  const err = await settle(h.controller.assetAnomalies(USER, ASSET, { from: FROM, to: TO }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.forAssetCalls).toEqual([]);
}

/** `E1.2b`: the checked id, the window as instants and one clock reach the service. */
export async function theAnomalyRouteHandsTheIdAndWindowToTheService(): Promise<void> {
  const h = harness();
  const before = Date.now();
  const body = await h.controller.assetAnomalies(USER, ASSET, { from: "2026-11-15T05:30:00+05:30", to: TO });
  expect(h.canReadCalls).toEqual([ASSET]);
  expect(h.forAssetCalls).toHaveLength(1);
  const call = h.forAssetCalls[0];
  expect(call?.assetId).toBe(ASSET);
  expect(call?.window.from.toISOString()).toBe(FROM);
  expect(call?.window.to.toISOString()).toBe(TO);
  expect(call?.now.getTime()).toBeGreaterThanOrEqual(before);
  expect(body).toEqual({ asOf: call?.now.toISOString(), scores: [] });
}

/** `E1.2b` (S1), `E1.9a`: the list hands `narrow`'s value (readable ids ANDed with the filter) to the service unchanged. */
export async function theAnomalyListHandsReadableAssetIdsToTheServiceUnchanged(): Promise<void> {
  for (const narrowed of [null, [], [ASSET, "99999999-9999-4999-8999-999999999999"]]) {
    const h = harness({ readable: ["77777777-7777-4777-8777-777777777777"], narrowed });
    await h.controller.anomalies(USER, {});
    expect(h.anomalyListCalls).toHaveLength(1);
    expect(h.anomalyListCalls[0]?.assetIds).toBe(narrowed);
    expect(h.narrowCalls).toEqual([{}]);
    expect(h.anomalyListCalls[0]?.since).toBeUndefined();
    expect(h.anomalyListCalls[0]?.now).toBeInstanceOf(Date);
  }
  const h = harness();
  await h.controller.anomalies(USER, { since: "2026-11-15T05:30:00+05:30" });
  expect(h.anomalyListCalls[0]?.since?.toISOString()).toBe(FROM);
  for (const query of [{ since: "yesterday" }, { since: FROM, limit: "1" }]) {
    const bad = harness();
    expect(await settle(bad.controller.anomalies(USER, query)), JSON.stringify(query)).toBeInstanceOf(
      BadRequestException,
    );
    expect(bad.anomalyListCalls).toEqual([]);
  }
}
