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
};

function harness(opts: { canRead?: boolean; readable?: string[] | null } = {}): Harness {
  const canReadCalls: string[] = [];
  const currentCalls: Harness["currentCalls"] = [];
  const listCalls: Harness["listCalls"] = [];
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
  } as unknown as MlForecastsService;
  return { controller: new MlController(service, accessControl), canReadCalls, currentCalls, listCalls };
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
