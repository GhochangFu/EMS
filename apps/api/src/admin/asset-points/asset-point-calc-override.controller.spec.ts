import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { AssetPointCalcOverrideController } from "./asset-point-calc-override.controller";
import type { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import type { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 (ADR 0109 decision 4) — the calc-points routes dispatch on
 * the asset's kind, and each kind parses its own body. No database: both
 * services are stubs that record which one was called.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};
const ASSET = "00000000-0000-4000-8000-0000000000a1";
const KEY = "KW_X2";

const ALL_NULL = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

function stubs(kind: "standalone" | "template") {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
    return {};
  };
  const override = {
    listCalcPoints: record("override.list"),
    setOverride: record("override.set"),
    clearOverride: record("override.clear"),
  } as unknown as AssetPointCalcOverrideService;
  const standalone = {
    kindOf: async () => ({ kind, organizationId: "org" }),
    list: record("standalone.list"),
    set: record("standalone.set"),
    remove: record("standalone.remove"),
  } as unknown as CalcPointStandaloneService;
  return { controller: new AssetPointCalcOverrideController(override, standalone), calls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

/** A template-less asset's PUT with a null formula is a 400 from the standalone schema. */
export async function aStandalonePutWithANullFormulaIsABadRequest(): Promise<void> {
  const { controller, calls } = stubs("standalone");
  const err = await rejects(() => controller.set(ASSET, KEY, { ...ALL_NULL, formulaDialect: "bms-calc-v1" }, JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** A template asset's all-null PUT parses under the override schema and reaches the override service. */
export async function aTemplatePutWithAllNullReachesTheOverride(): Promise<void> {
  const { controller, calls } = stubs("template");
  await controller.set(ASSET, KEY, ALL_NULL, JWT);
  expect(calls).toEqual(["override.set"]);
}

/** A complete standalone body reaches the standalone service. */
export async function aCompleteStandalonePutReachesTheStandaloneService(): Promise<void> {
  const { controller, calls } = stubs("standalone");
  await controller.set(
    ASSET,
    KEY,
    { formula: "{KW} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "scheduled", calcIntervalSeconds: 60, maxInputAgeSeconds: 300 },
    JWT,
  );
  expect(calls).toEqual(["standalone.set"]);
}

/** GET on a template-less asset lists the standalone points. */
export async function aStandaloneGetListsTheStandalonePoints(): Promise<void> {
  const { controller, calls } = stubs("standalone");
  await controller.list(ASSET, JWT);
  expect(calls).toEqual(["standalone.list"]);
}

/** GET on a template asset lists the overrides. */
export async function aTemplateGetListsTheOverrides(): Promise<void> {
  const { controller, calls } = stubs("template");
  await controller.list(ASSET, JWT);
  expect(calls).toEqual(["override.list"]);
}

/** DELETE on a template-less asset removes the standalone point. */
export async function aStandaloneDeleteRemovesThePoint(): Promise<void> {
  const { controller, calls } = stubs("standalone");
  await controller.clear(ASSET, KEY, JWT);
  expect(calls).toEqual(["standalone.remove"]);
}

/** DELETE on a template asset clears the override. */
export async function aTemplateDeleteClearsTheOverride(): Promise<void> {
  const { controller, calls } = stubs("template");
  await controller.clear(ASSET, KEY, JWT);
  expect(calls).toEqual(["override.clear"]);
}
