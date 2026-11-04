import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { CalcPointBatchController } from "./calc-point-batch.controller";
import type { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 (ADR 0109 decision 4, ruling 4) — `POST
 * /admin/calc-points/batch`'s parse boundary. No database: the service is a
 * stub. A malformed body is a 400 carrying `flatten()`, never a raw
 * `ZodError` (a 500), and the service never sees it.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

const body = (n: number) => ({
  assetIds: ids(n),
  pointKey: "KW_X2",
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
});

function stub(): { controller: CalcPointBatchController; calls: unknown[] } {
  const calls: unknown[] = [];
  const service = {
    async setBatch(_jwt: JwtPayload, parsed: unknown) {
      calls.push(parsed);
      return { items: [] };
    },
  } as unknown as CalcPointStandaloneService;
  return { controller: new CalcPointBatchController(service), calls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

/** 25 assets reach the service. */
export async function aBatchOfTwentyFiveReachesTheService(): Promise<void> {
  const { controller, calls } = stub();
  await controller.setBatch(body(25), JWT);
  expect(calls).toHaveLength(1);
}

/** 26 assets are a 400 at the schema, before the service. */
export async function aBatchOfTwentySixIsABadRequest(): Promise<void> {
  const { controller, calls } = stub();
  const err = await rejects(() => controller.setBatch(body(26), JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** A null formula is a 400 naming `formula`. */
export async function aBatchWithANullFormulaNamesTheField(): Promise<void> {
  const { controller } = stub();
  const err = await rejects(() => controller.setBatch({ ...body(1), formula: null }, JWT));
  const fieldErrors = ((err as BadRequestException).getResponse() as { fieldErrors?: Record<string, string[]> })
    .fieldErrors;
  expect(fieldErrors?.formula?.length ?? 0).toBeGreaterThan(0);
}
