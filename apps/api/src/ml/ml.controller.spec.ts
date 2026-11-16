import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { encodePointRef, type JwtPayload } from "@bms/shared";
import { expect } from "vitest";

import type { AccessControlService } from "../auth/access-control.service";
import { MlController } from "./ml.controller";
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
};

function harness(opts: { canRead?: boolean; readable?: string[] | null } = {}): Harness {
  const canReadCalls: string[] = [];
  const currentCalls: Harness["currentCalls"] = [];
  const listCalls: Harness["listCalls"] = [];
  const pastCalls: Harness["pastCalls"] = [];
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
  return { controller: new MlController(service, accessControl), canReadCalls, currentCalls, listCalls, pastCalls };
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
  for (const readable of [null, [], [ASSET, "99999999-9999-4999-8999-999999999999"]]) {
    const h = harness({ readable });
    await h.controller.list(USER);
    expect(h.listCalls).toHaveLength(1);
    expect(h.listCalls[0]?.assetIds).toBe(readable);
    expect(h.listCalls[0]?.now).toBeInstanceOf(Date);
  }
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
