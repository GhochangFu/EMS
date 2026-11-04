import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { AssetPointCalcOverrideBody, CalcPointBatchBody, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { rememberIdentity } from "../../auth/identity-resolver";
import type { CalcDependencyService } from "../../calc/calc-dependency.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import type { BackfillRequest, CalcBackfillRequestService } from "./calc-backfill-request.service";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 5 review — `backfillDays` reaches `CalcBackfillRequestService`
 * from the override `PUT` (owner ruling 1) and from the batch, **after** the
 * write's transaction. No database: each service's reads are stubbed at its
 * own private seams (the context read, the rule check, the row write, the
 * echo), and what is recorded is the order of the transaction and the
 * `start` request. `calc-point-standalone.backfill.integration` and
 * `asset-point-calc-override.backfill.integration` hold the same claims
 * against Postgres and Redis.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-0000000000aa",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};
const ACTOR = "00000000-0000-4000-8000-0000000000ab";
const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET_A = "00000000-0000-4000-8000-00000000000a";
const ASSET_B = "00000000-0000-4000-8000-00000000000b";

/** What one write did, in order: `commit` when its transaction returned, `start` when the backfill was asked for. */
type Record = { readonly events: string[]; readonly requests: BackfillRequest[] };

function recorder(): Record & { backfill: CalcBackfillRequestService; db: BmsDb } {
  const events: string[] = [];
  const requests: BackfillRequest[] = [];
  const backfill = {
    start: async (request: BackfillRequest) => {
      events.push("start");
      requests.push(request);
    },
    latestForPoints: async () => new Map(),
  } as unknown as CalcBackfillRequestService;
  const tx = {
    execute: async () => undefined,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const db = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const out = await fn(tx);
      events.push("commit");
      return out;
    },
  } as unknown as BmsDb;
  rememberIdentity(JWT, { id: ACTOR } as never);
  return { events, requests, backfill, db };
}

// ---- the override PUT -------------------------------------------------------

const OVERRIDE_BODY: AssetPointCalcOverrideBody = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: 45,
  maxInputAgeSeconds: null,
};

async function putOverride(body: AssetPointCalcOverrideBody): Promise<Record> {
  const r = recorder();
  const svc = new AssetPointCalcOverrideService(
    r.db,
    {} as BmsDb,
    {} as AccessControlService,
    { write: async () => undefined } as unknown as MasterDataAuditService,
    {} as CalcDependencyService,
    {} as never,
    {} as never,
    r.backfill,
  );
  Object.assign(svc, {
    resolveWritableContext: async () => ({
      organizationId: ORG,
      templatePointId: "tp-1",
      template: {
        formula: "{KW} * 2",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: 300,
        maxInputAgeSeconds: 600,
      },
      declared: { measured: ["KW"], all: ["KW", "KWH"] },
      existingRowId: "row-kwh",
    }),
    readOne: async () => ({}),
  });
  await svc.setOverride(JWT, ASSET_A, "KWH", body);
  return r;
}

/** An override `PUT` with `backfillDays` asks for one run on the saved row, over those days, for its actor. */
export async function anOverridePutWithBackfillDaysStartsOneRun(): Promise<void> {
  const { requests } = await putOverride({ ...OVERRIDE_BODY, backfillDays: 7 });
  expect(requests).toEqual([
    { organizationId: ORG, requestedBy: ACTOR, days: 7, targets: [{ assetPointId: "row-kwh", label: "KWH" }] },
  ]);
}

/** …after the override's transaction committed (ruling 4: a refused backfill never undoes the override). */
export async function anOverridesBackfillStartsAfterTheCommit(): Promise<void> {
  const { events } = await putOverride({ ...OVERRIDE_BODY, backfillDays: 7 });
  expect(events).toEqual(["commit", "start"]);
}

/** An override `PUT` without `backfillDays` asks for nothing. */
export async function anOverridePutWithoutBackfillDaysStartsNothing(): Promise<void> {
  const { requests } = await putOverride(OVERRIDE_BODY);
  expect(requests).toEqual([]);
}

// ---- the batch --------------------------------------------------------------

const BATCH_BODY: CalcPointBatchBody = {
  assetIds: [ASSET_A, ASSET_B],
  pointKey: "KW_X2",
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
};

async function postBatch(body: CalcPointBatchBody): Promise<Record> {
  const r = recorder();
  const codeOf = (id: string) => (id === ASSET_A ? "A-1" : "B-1");
  const fleet: { [k: string]: unknown } = {};
  fleet.select = () => fleet;
  fleet.from = () => fleet;
  fleet.where = async () =>
    body.assetIds.map((id) => ({ id, code: codeOf(id), templateId: null, organizationId: ORG }));
  const svc = new CalcPointStandaloneService(
    r.db,
    fleet as unknown as BmsDb,
    { requireMasterDataUser: async () => undefined, canManageAsset: async () => true } as unknown as AccessControlService,
    { writeMany: async () => undefined } as unknown as MasterDataAuditService,
    { checkCandidates: async () => [] } as unknown as CalcDependencyService,
    {} as never,
    {} as never,
    {} as never,
    r.backfill,
  );
  Object.assign(svc, {
    validate: async (_jwt: unknown, asset: { id: string; code: string }, pointKey: string) => ({
      ok: true,
      prepared: {
        assetId: asset.id,
        assetCode: asset.code,
        organizationId: ORG,
        pointKey,
        unit: null,
        existingRowId: null,
        newSourceDataKey: `computed:${pointKey}`,
        values: {},
        candidate: null,
      },
    }),
    writeRow: async (_tx: unknown, entry: { assetId: string }) => `row-${entry.assetId}`,
    readOne: async () => ({}),
  });
  await svc.setBatch(JWT, body);
  return r;
}

/** A batch with `backfillDays` asks for one run per written point, each named by its asset's code. */
export async function aBatchWithBackfillDaysStartsOneRunPerPoint(): Promise<void> {
  const { requests } = await postBatch({ ...BATCH_BODY, backfillDays: 14 });
  expect(requests.map((request) => request.targets)).toEqual([
    [
      { assetPointId: `row-${ASSET_A}`, label: "A-1" },
      { assetPointId: `row-${ASSET_B}`, label: "B-1" },
    ],
  ]);
}

/** …after the batch's one transaction committed. */
export async function aBatchsBackfillStartsAfterTheCommit(): Promise<void> {
  const { events } = await postBatch({ ...BATCH_BODY, backfillDays: 14 });
  expect(events).toEqual(["commit", "start"]);
}

/** A batch without `backfillDays` asks for nothing. */
export async function aBatchWithoutBackfillDaysStartsNothing(): Promise<void> {
  const { requests } = await postBatch(BATCH_BODY);
  expect(requests).toEqual([]);
}
