import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, RuleBatchBody } from "@bms/shared";

import { EvaluateThrottle } from "./evaluate-throttle";
import { RulesController } from "./rules.controller";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — `POST /rules/batch`'s handler, driven
 * by hand (the `rules-notifications.spec.ts` style, §4.6: no Nest module in a
 * unit test). The order is the claim: the role check runs before the body is
 * read, then the route's own body schema, then the service with the caller's
 * readable assets.
 */

type Ctor = ConstructorParameters<typeof RulesController>;

const USER = { sub: "u1", email: "wc-admin@bms.local" } as unknown as JwtPayload;
const READABLE = ["00000000-0000-4000-8000-0000000000a1"];

const ROW = {
  name: "Chiller high",
  ruleType: "threshold",
  assetId: "00000000-0000-4000-8000-0000000000a1",
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};

type Call = { dto: RuleBatchBody; actor: unknown; assetIds: unknown };

function controllerWith(options: { writeAllowed?: boolean } = {}): { controller: RulesController; calls: Call[] } {
  const calls: Call[] = [];
  const accessControl = {
    assertOperationsWriteRole: () =>
      options.writeAllowed === false ? Promise.reject(new ForbiddenException("configuration write denied")) : Promise.resolve(),
    readableAssetIds: () => Promise.resolve(READABLE),
  } as unknown as Ctor[1];
  const rulesBatch = {
    createAndPublish: (dto: RuleBatchBody, actor: unknown, assetIds: unknown) => {
      calls.push({ dto, actor, assetIds });
      return Promise.resolve({ items: [] });
    },
  } as unknown as Ctor[5];
  const unused = {} as unknown;
  return {
    controller: new RulesController(
      unused as Ctor[0],
      accessControl,
      unused as Ctor[2],
      new EvaluateThrottle(),
      unused as Ctor[4],
      rulesBatch,
    ),
    calls,
  };
}

/** The rejection of `promise`, or `null` when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

/** A caller without the configuration write role is a 403 even for a body the schema refuses: the body is never read. */
export async function aViewerIsRefusedBeforeTheBodyIsRead(): Promise<void> {
  const { controller, calls } = controllerWith({ writeAllowed: false });
  const err = await rejection(controller.createRuleBatch({ rules: [] }, USER));
  expect([err instanceof ForbiddenException, calls.length]).toEqual([true, 0]);
}

/** A body the batch schema refuses is a 400, and the service is never called. */
export async function aMalformedBodyIsA400(): Promise<void> {
  const { controller, calls } = controllerWith();
  const err = await rejection(controller.createRuleBatch({ rules: [ROW], excludedRows: [25] }, USER));
  expect([err instanceof BadRequestException, calls.length]).toEqual([true, 0]);
}

/** The parsed body (the schema's defaults applied), the caller and the caller's readable assets reach the service. */
export async function theDtoAndTheReadableAssetsReachTheService(): Promise<void> {
  const { controller, calls } = controllerWith();
  await controller.createRuleBatch({ rules: [ROW], excludedRows: [0] }, USER);
  expect(calls).toEqual([
    {
      dto: { rules: [{ ...ROW, category: expect.any(String) }], excludedRows: [0] },
      actor: USER,
      assetIds: READABLE,
    },
  ]);
}
