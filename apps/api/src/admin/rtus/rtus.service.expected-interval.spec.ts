import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RtusAdminService } from "./rtus.service";

/**
 * `F4.350` (ADR 0075 Amendment 3) — `create` and `update` carry `expectedIntervalSeconds` into the row:
 * `create` writes it (or NULL), `update` keeps the stored value when the body omits it, sets a number,
 * and clears it on `null`. Observed at the service boundary with no database (ADR 0014: assertions
 * here, the sibling `.test.ts` is the entry point), the `rtus.service.conflict.spec.ts` recipe.
 *
 * The fake records the values handed to `insert().values()` / `update().set()` and then rejects with a
 * sentinel, which the service re-throws by identity (it only maps its own constraint errors). So the
 * case reads exactly what would have been written, without mimicking everything that follows a write.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-0000000000f2",
  email: "f4.350@bms.local",
  name: "F4.350 fake",
  role: "admin",
};

const RTU_ID = "00000000-0000-4000-8000-0000000000a2";
const LOCATION_ID = "00000000-0000-4000-8000-0000000000b2";
const ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000c2";

const SENTINEL = new Error("F4.350: stop after recording the write");

function serviceRecording(
  storedInterval: number | null,
  written: Record<string, unknown>[],
): RtusAdminService {
  const existing = {
    id: RTU_ID,
    locationId: LOCATION_ID,
    organizationId: ORGANIZATION_ID,
    code: "f4.350-fake",
    displayName: "F4.350 fake",
    sourceType: "catalog",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    releasedMqttTopic: null,
    stationCode: null,
    stationName: null,
    expectedIntervalSeconds: storedInterval,
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
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        written.push(values);
        return { returning: () => Promise.reject(SENTINEL) };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        written.push(values);
        return { where: () => Promise.reject(SENTINEL) };
      },
    }),
  };
  const tenantDb = { transaction: (fn: (inner: unknown) => Promise<unknown>) => fn(tx) } as never;
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageLocation: () => Promise.resolve(true),
  } as never;
  return new RtusAdminService(fleetDb, tenantDb, accessControl, {} as never);
}

async function writtenBy(run: (service: RtusAdminService) => Promise<unknown>, stored: number | null): Promise<unknown> {
  const written: Record<string, unknown>[] = [];
  await expect(run(serviceRecording(stored, written))).rejects.toBe(SENTINEL);
  expect(written).toHaveLength(1);
  return written[0]?.expectedIntervalSeconds;
}

const createBody = (extra: Record<string, unknown>) =>
  ({ locationId: LOCATION_ID, code: "f4.350-fake", displayName: "F4.350 fake", sourceType: "catalog", ...extra }) as Parameters<
    RtusAdminService["create"]
  >[1];

/** I1 — `create` writes the number it was given, and NULL when it was given none. */
export async function createWritesTheIntervalOrNull(): Promise<void> {
  expect(await writtenBy((s) => s.create(JWT, createBody({ expectedIntervalSeconds: 60 })), null)).toBe(60);
  expect(await writtenBy((s) => s.create(JWT, createBody({})), null)).toBeNull();
}

/** I2 — `update` keeps the stored interval when the body omits it. */
export async function updateKeepsTheStoredIntervalWhenOmitted(): Promise<void> {
  expect(await writtenBy((s) => s.update(JWT, RTU_ID, { displayName: "renamed" }), 90)).toBe(90);
}

/** I3 — `update` sets a new number, and `null` clears it. */
export async function updateSetsAndClearsTheInterval(): Promise<void> {
  expect(await writtenBy((s) => s.update(JWT, RTU_ID, { expectedIntervalSeconds: 120 }), 90)).toBe(120);
  expect(await writtenBy((s) => s.update(JWT, RTU_ID, { expectedIntervalSeconds: null }), 90)).toBeNull();
}
