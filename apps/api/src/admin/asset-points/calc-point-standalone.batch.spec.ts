import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { CalcPointBatchBody, CalcPointRefusal, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 review — the batch's refusal for an asset id the caller may not
 * see. No database: the asset read is a stub and access is a fake. A missing
 * id and an asset outside the caller's write scope must be indistinguishable,
 * or a typed id becomes an existence oracle across scopes and organizations.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "location-admin@bms.local",
  name: "spec",
  role: "admin",
};

const MISSING = "00000000-0000-4000-8000-00000000000a";
const OUT_OF_SCOPE = "00000000-0000-4000-8000-00000000000b";

const BODY: CalcPointBatchBody = {
  assetIds: [MISSING, OUT_OF_SCOPE],
  pointKey: "KW_X2",
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
};

/** `fleetDb.select().from().where()` answers the one asset that exists; nothing else is read. */
function fleetDb(): BmsDb {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () =>
    Promise.resolve([{ id: OUT_OF_SCOPE, code: "SECRET-CODE", templateId: null, organizationId: "org-b" }]);
  return chain as unknown as BmsDb;
}

async function refusals(): Promise<CalcPointRefusal[]> {
  const accessControl = {
    requireMasterDataUser: async () => undefined,
    canManageAsset: async () => false,
  } as unknown as AccessControlService;
  const dependencies = { checkCandidates: async () => [] } as unknown as CalcDependencyService;
  const svc = new CalcPointStandaloneService(
    {} as BmsDb,
    fleetDb(),
    accessControl,
    {} as never,
    dependencies,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  try {
    await svc.setBatch(JWT, BODY);
  } catch (err) {
    if (err instanceof BadRequestException) {
      return (err.getResponse() as { refused: CalcPointRefusal[] }).refused;
    }
    throw err;
  }
  throw new Error("expected the batch to be refused");
}

/** A missing id and an out-of-scope asset get the same sentence. */
export async function aMissingAndAnOutOfScopeAssetShareOneReason(): Promise<void> {
  const refused = await refusals();
  expect(refused.map((r) => r.assetId)).toEqual([MISSING, OUT_OF_SCOPE]);
  expect(refused[0]?.reason).toBe(refused[1]?.reason);
}

/** Neither refusal carries a code — the out-of-scope asset's code is never echoed. */
export async function neitherRefusalCarriesACode(): Promise<void> {
  const refused = await refusals();
  expect(refused.map((r) => r.assetCode)).toEqual([null, null]);
}
