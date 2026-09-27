import { ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RTU_ORG_MISMATCH_MESSAGE, RtusAdminService } from "./rtus.service";

/**
 * `F4.138` — the three RTU write paths refuse a row whose `organization_id`
 * disagrees with its location's, observed at the service boundary with no
 * database (ADR 0014: assertions here, Vitest blocks in the sibling `.test.ts`).
 *
 * **What only a fake can show.** The integration pair proves that nothing lands
 * under the real policy, but a refusal raised *inside* `withTenant` after the
 * writes would roll back and pass it too. The claim that the tenant transaction
 * is never opened, and that the grant is checked before the organizations are
 * compared, lives here.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-0000000000f2",
  email: "f4.138@bms.local",
  name: "F4.138 fake",
  role: "admin",
};

const RTU_ID = "00000000-0000-4000-8000-0000000000a2";
const LOCATION_ID = "00000000-0000-4000-8000-0000000000b2";
/** The RTU's own column. */
const RTU_ORG_ID = "00000000-0000-4000-8000-0000000000c2";
/** The location's organization — different, so the row has drifted. */
const LOCATION_ORG_ID = "00000000-0000-4000-8000-0000000000d2";

type WritePath = "update" | "deactivate" | "reactivate";

interface DriftedService {
  service: RtusAdminService;
  /** Whether `tenantDb.transaction` was called at all. */
  transactionOpened: () => boolean;
}

/**
 * An `RtusAdminService` whose `fleetDb` answers the `existing` RTU read with a
 * row stamped `RTU_ORG_ID`, then the `locations` read with `LOCATION_ORG_ID`.
 * The two reads share one select chain, so the answers are a queue in call
 * order. The tenant transaction records that it opened and then rejects, so a
 * path that reaches it cannot resolve.
 */
function driftedService(canManage: boolean): DriftedService {
  const existing = {
    id: RTU_ID,
    locationId: LOCATION_ID,
    organizationId: RTU_ORG_ID,
    code: "f4-138-fake",
    displayName: "F4.138 fake",
    sourceType: "catalog",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: false,
    meta: null,
    active: true,
  };
  const answers: unknown[][] = [[existing], [{ organizationId: LOCATION_ORG_ID }]];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(answers.shift() ?? []),
  };
  const fleetDb = { select: () => chain } as never;

  let opened = false;
  const tenantDb = {
    transaction: () => {
      opened = true;
      return Promise.reject(new Error("F4.138 fake: the tenant transaction was opened"));
    },
  } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageLocation: () => Promise.resolve(canManage),
  } as never;

  return {
    service: new RtusAdminService(fleetDb, tenantDb, accessControl, {} as never),
    transactionOpened: () => opened,
  };
}

function callPath(service: RtusAdminService, path: WritePath): Promise<unknown> {
  switch (path) {
    case "update":
      return service.update(JWT, RTU_ID, { displayName: "F4.138 renamed", ingestEnabled: true });
    case "deactivate":
      return service.deactivate(JWT, RTU_ID);
    case "reactivate":
      return service.reactivate(JWT, RTU_ID);
  }
}

/** The error a call refused with, or a failure if it did not refuse at all. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("F4.138: the call resolved where a refusal was expected");
}

/**
 * The path refuses a drifted RTU with the ruled 500. Two `expect`s on one
 * thrown object are one claim: the class alone would pass any other 500.
 */
export async function assertPathRefusesADriftedRtuWithA500(path: WritePath): Promise<void> {
  const { service } = driftedService(true);
  const error = await rejectionOf(callPath(service, path));
  expect(error).toBeInstanceOf(InternalServerErrorException);
  expect((error as InternalServerErrorException).message).toBe(RTU_ORG_MISMATCH_MESSAGE);
}

/** The path refuses before `withTenant` opens its transaction. */
export async function assertPathNeverOpensTheTenantTransaction(path: WritePath): Promise<void> {
  const { service, transactionOpened } = driftedService(true);
  await rejectionOf(callPath(service, path));
  expect(transactionOpened()).toBe(false);
}

/**
 * A caller without the grant gets the same 403 as before `F4.138`: the grant is
 * checked first, and the mismatch is a fact only a manager of the location sees.
 */
export async function assertCallerWithoutTheGrantGetsA403(path: WritePath): Promise<void> {
  const { service } = driftedService(false);
  expect(await rejectionOf(callPath(service, path))).toBeInstanceOf(ForbiddenException);
}
