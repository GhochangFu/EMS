import { ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RtusAdminService } from "./rtus.service";

/**
 * `F4.141` — the service's two `.catch` sites, observed at the service boundary
 * with no database (ADR 0014: assertions here, Vitest blocks in the sibling
 * `.test.ts`).
 *
 * **Why a fake and not the integration suite.** The negative — an error the
 * map does not own is re-thrown *by identity* — is unreachable against the real
 * database: `create` resolves the location before it inserts (a missing one is
 * a 404/403, never a `23503`), `rtus_pkey` is `defaultRandom()`, and `update`
 * cannot change `location_id`. So the only way to put a foreign-key violation
 * through either `.catch` is to have the transaction reject with one. The shape
 * is `serviceFailingTheLocationInsert` in `onboarding-commit-conflict.spec.ts`.
 *
 * The positive controls matter as much as the negatives: without them, a
 * service whose `.catch` had been removed would pass both identity checks.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-0000000000f1",
  email: "f4.141@bms.local",
  name: "F4.141 fake",
  role: "admin",
};

const RTU_ID = "00000000-0000-4000-8000-0000000000a1";
const LOCATION_ID = "00000000-0000-4000-8000-0000000000b1";
const ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000c1";

type DriverError = Error & { code: string; constraint: string; table: string; schema: string };

function pgError(code: string, constraint: string): DriverError {
  return Object.assign(new Error("integrity violation"), {
    code,
    constraint,
    table: "rtus",
    schema: "bms",
  });
}

/**
 * An `RtusAdminService` whose write, on either path, rejects with `err`.
 *
 * One `fleetDb` select chain serves every read that precedes a write:
 * `resolveLocationOrg` on `create` (it reads `organizationId`), and on `update`
 * the `existing` row and then the location's org (`F4.138` compares the two).
 * The chain answers both of `update`'s reads with the same row, so the two
 * orgs agree and the write goes ahead. `withTenant` calls `tenantDb.transaction`
 * and then `tx.execute` for the GUC before the body runs.
 */
function serviceFailingTheRtuWrite(err: unknown): RtusAdminService {
  const existing = {
    id: RTU_ID,
    locationId: LOCATION_ID,
    organizationId: ORGANIZATION_ID,
    code: "f4.141-fake",
    displayName: "F4.141 fake",
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
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([existing]),
  };
  const fleetDb = { select: () => chain } as never;

  const tx = {
    execute: () => Promise.resolve(),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(err) }) }),
    update: () => ({ set: () => ({ where: () => Promise.reject(err) }) }),
  };
  const tenantDb = {
    transaction: (fn: (inner: unknown) => Promise<unknown>) => fn(tx),
  } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageLocation: () => Promise.resolve(true),
  } as never;

  return new RtusAdminService(fleetDb, tenantDb, accessControl, {} as never);
}

/** The error a call refused with, or a failure if it did not refuse at all. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("F4.141: the call resolved where a refusal was expected");
}

function createBody(): Parameters<RtusAdminService["create"]>[1] {
  return {
    locationId: LOCATION_ID,
    code: "f4.141-fake",
    displayName: "F4.141 fake",
    sourceType: "catalog",
  };
}

/** Positive control: `create`'s `.catch` turns a mapped duplicate into the ruled 409. */
export async function assertCreateAnswersAMappedDuplicateAsTheRuledConflict(): Promise<void> {
  const service = serviceFailingTheRtuWrite(pgError("23505", "rtus_mqtt_topic_idx"));
  const error = await rejectionOf(service.create(JWT, createBody()));
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(
    "That mqttTopic is already taken. Choose a different mqttTopic.",
  );
}

/**
 * `create` re-throws a foreign-key violation **by identity**. `toBe`, not
 * `toEqual` or `toBeInstanceOf(Error)`: the claim is that the original object
 * survives with its stack, and that it is not re-described as a conflict.
 */
export async function assertCreateRethrowsAForeignKeyViolationByIdentity(): Promise<void> {
  const err = pgError("23503", "rtus_location_id_locations_id_fk");
  const service = serviceFailingTheRtuWrite(err);
  expect(await rejectionOf(service.create(JWT, createBody()))).toBe(err);
}

/** Positive control: `update`'s `.catch` turns a mapped duplicate into the ruled 409. */
export async function assertUpdateAnswersAMappedDuplicateAsTheRuledConflict(): Promise<void> {
  const service = serviceFailingTheRtuWrite(pgError("23505", "rtus_location_code_unique"));
  const error = await rejectionOf(service.update(JWT, RTU_ID, { code: "f4.141-taken" }));
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(
    "Another RTU at this location already uses that code. Choose a different code.",
  );
}

/** `update` re-throws a foreign-key violation by identity. */
export async function assertUpdateRethrowsAForeignKeyViolationByIdentity(): Promise<void> {
  const err = pgError("23503", "rtus_location_id_locations_id_fk");
  const service = serviceFailingTheRtuWrite(err);
  expect(await rejectionOf(service.update(JWT, RTU_ID, { code: "f4.141-other" }))).toBe(err);
}
