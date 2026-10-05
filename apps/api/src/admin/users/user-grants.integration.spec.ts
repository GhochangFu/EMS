import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { rememberIdentity } from "../../auth/identity-resolver";
import { withTenant } from "../../database/tenant-context";
import { FakeIdentityAdmin } from "../../identity/testing/fake-identity-admin";
import { withRollback } from "../../testing/with-rollback";
import { MasterDataAuditService } from "../master-data-audit.service";
import { GRANT_NOT_FOUND, GRANT_TARGET_CHANGED, UserGrantsService } from "./user-grants.service";
import { UsersService } from "./users.service";

/**
 * `F3.78` / ADR 0089 decision 10 — `UserGrantsService` driving its own
 * statements on `bms_tenant`. A fake proves neither `0098`'s
 * `tenant_isolation` policy on `user_location_access` nor what it does to an
 * insert or a delete under the wrong GUC — and the two differ: the policy's
 * `WITH CHECK` **raises** `42501` on an insert, its `USING` **filters** a
 * delete to zero rows.
 *
 * Every case runs inside `withRollback` on the superuser pool and calls
 * `tx.rollback()` (`tests/f3.60-withrollback-cases-roll-back.test.ts`). The
 * case inserts its own users and locations as the superuser (never a seeded
 * user, never a committed `oidc_subject`), then hands the service a wrapper of
 * that transaction ({@link asRole}) whose `transaction(fn)` opens a savepoint,
 * switches to `bms_tenant` with `SET LOCAL ROLE` and records `current_user` —
 * so `withTenant`'s statements run as the role they run as in production.
 * Reads go to the superuser transaction directly, which sees what `bms_fleet`
 * (BYPASSRLS) sees.
 */

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows;

/**
 * `tx`, except that `transaction(fn)` runs `beforeWrite` (as the superuser,
 * outside the savepoint, so a failed `fn` does not undo it), then opens a
 * savepoint, switches to `bms_tenant`, records `current_user` into `roles`,
 * runs `fn`, and switches back.
 */
function asTenant(tx: BmsDb, roles: string[], beforeWrite?: (db: BmsDb) => Promise<void>): BmsDb {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return async (fn: (sp: unknown) => Promise<unknown>) => {
          if (beforeWrite) await beforeWrite(target);
          return target.transaction(async (sp) => {
            await sp.execute(sql.raw("SET LOCAL ROLE bms_tenant"));
            const [who] = rowsOf<{ name: string }>(await sp.execute(sql`SELECT current_user AS name`));
            roles.push(who?.name ?? "nobody");
            const result = await fn(sp);
            await sp.execute(sql`RESET ROLE`);
            return result;
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function organizationId(db: Pick<BmsDb, "execute">, code: string): Promise<string> {
  const [row] = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM bms.organizations WHERE code = ${code}`));
  if (!row) throw new Error(`F3.78: organization ${code} is missing — run pnpm db:seed`);
  return row.id;
}

type Fixture = { id: string; email: string; role: UserRole; organizationId: string | null };

/** An unlinked fixture user (`oidc_subject` NULL), inserted as the superuser inside the case's transaction. */
async function insertUser(db: Pick<BmsDb, "execute">, role: UserRole, org: string | null): Promise<Fixture> {
  const id = randomUUID();
  const email = `f3.78-pr2-${id}@fixture.local`;
  await db.execute(sql`
    INSERT INTO bms.users (id, organization_id, email, display_name, role)
    VALUES (${id}, ${org}, ${email}, 'F3.78 PR2 grants fixture', ${role})
  `);
  return { id, email, role, organizationId: org };
}

/** A fixture location in `org`, with a seeded location type. */
async function insertLocation(db: Pick<BmsDb, "execute">, org: string): Promise<string> {
  const id = randomUUID();
  const code = `F378-${id.slice(0, 8)}`;
  await db.execute(sql`
    INSERT INTO bms.locations (id, code, slug, name, type, latitude, longitude, organization_id)
    VALUES (${id}, ${code}, ${code.toLowerCase()}, 'F3.78 PR2 grants fixture',
            (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, ${org})
  `);
  return id;
}

function callerJwt(caller: Fixture): JwtPayload {
  const jwt: JwtPayload = { sub: caller.id, email: caller.email, name: "F3.78 caller", role: caller.role };
  rememberIdentity(jwt, {
    id: caller.id,
    email: caller.email,
    displayName: "F3.78 caller",
    role: caller.role,
    organizationId: caller.organizationId,
    oidcSubject: null,
    disabledAt: null,
  });
  return jwt;
}

/** The service as an `admin` caller sees it: every target in scope, so only the database decides. */
function buildService(fleetDb: BmsDb, tenantDb: BmsDb): UserGrantsService {
  vi.stubEnv("AUTH_MODE", "oidc");
  const accessControl = {
    writableOrganizationIds: async () => null,
    canManageOrganization: async () => true,
    canManageLocation: async () => true,
  } as unknown as AccessControlService;
  const audit = new MasterDataAuditService(tenantDb, fleetDb);
  const users = new UsersService(fleetDb, tenantDb, accessControl, audit, new FakeIdentityAdmin());
  return new UserGrantsService(fleetDb, tenantDb, accessControl, audit, users);
}

async function grantCount(db: Pick<BmsDb, "execute">, userId: string, locationId: string): Promise<number> {
  const [row] = rowsOf<{ n: number }>(
    await db.execute(
      sql`SELECT count(*)::int AS n FROM bms.user_location_access WHERE user_id = ${userId} AND location_id = ${locationId}`,
    ),
  );
  return row?.n ?? -1;
}

async function grantAudits(db: Pick<BmsDb, "execute">, userId: string): Promise<{ action: string; organization_id: string }[]> {
  return rowsOf<{ action: string; organization_id: string }>(
    await db.execute(sql`
      SELECT action, organization_id FROM bms.audit_log
       WHERE action LIKE 'master.user_grant.%' AND payload->>'userId' = ${userId}
    `),
  );
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

// -- the grant lands ----------------------------------------------------------

type Landed = { roles: string[]; grants: number; audits: { action: string; organization_id: string }[]; phewb: string };

/**
 * An `admin` grants a home-ESKOM user a PHEWB location: the write runs in
 * `withTenant` of the **location's** organization (PHEWB), not the user's.
 */
async function grantACrossOrganizationLocation(superDb: BmsDb): Promise<Landed> {
  let landed: Landed | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const caller = await insertUser(db, "admin", null);
    const user = await insertUser(db, "viewer", eskom);
    const location = await insertLocation(db, phewb);
    const roles: string[] = [];
    const service = buildService(db, asTenant(db, roles));
    await service.add(callerJwt(caller), user.id, { kind: "location", targetId: location });
    landed = { roles, grants: await grantCount(db, user.id, location), audits: await grantAudits(db, user.id), phewb };
    tx.rollback();
  });
  if (!landed) throw new Error("F3.78: the grant case never ran");
  return landed;
}

export async function assertALocationGrantLandsUnderTheLocationsOrganization(superDb: BmsDb): Promise<void> {
  const landed = await grantACrossOrganizationLocation(superDb);
  expect(landed.roles).toEqual(["bms_tenant"]);
  expect(landed.grants).toBe(1);
}

export async function assertTheGrantAuditRowIsStampedWithTheLocationsOrganization(superDb: BmsDb): Promise<void> {
  const landed = await grantACrossOrganizationLocation(superDb);
  expect(landed.audits).toEqual([{ action: "master.user_grant.add", organization_id: landed.phewb }]);
}

// -- (a) an insert under the wrong GUC ------------------------------------------

/**
 * (a) The statement itself: a `user_location_access` insert as `bms_tenant`
 * under the user's home organization (ESKOM) for a PHEWB location **raises
 * `42501`** — the policy's `WITH CHECK` refuses; it does not return zero rows.
 */
export async function assertAnInsertUnderTheHomeOrganizationRaises42501(superDb: BmsDb): Promise<void> {
  let code: string | undefined = "never ran";
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const user = await insertUser(db, "viewer", eskom);
    const location = await insertLocation(db, phewb);
    const err = await caught(
      withTenant(asTenant(db, []), eskom, (sp) =>
        sp.execute(sql`INSERT INTO bms.user_location_access (user_id, location_id) VALUES (${user.id}, ${location})`),
      ),
    );
    code = (err as { code?: string } | null)?.code;
    tx.rollback();
  });
  expect(code).toBe("42501");
}

type Refused = { error: unknown; grants: number; audits: number; roles: string[]; location: string };

/**
 * (a) Through the service: the location is ESKOM's when the service reads it
 * and PHEWB's when it writes (the superuser moves it before the service's
 * transaction opens), so the service's `withTenant(ESKOM)` insert meets the
 * `WITH CHECK` refusal.
 */
async function addAfterTheLocationMoved(superDb: BmsDb): Promise<Refused> {
  let outcome: Refused | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const caller = await insertUser(db, "admin", null);
    const user = await insertUser(db, "viewer", eskom);
    const location = await insertLocation(db, eskom);
    const roles: string[] = [];
    const moveTheLocation = async (sp: BmsDb) => {
      await sp.execute(sql`UPDATE bms.locations SET organization_id = ${phewb} WHERE id = ${location}`);
    };
    const service = buildService(db, asTenant(db, roles, moveTheLocation));
    const error = await caught(service.add(callerJwt(caller), user.id, { kind: "location", targetId: location }));
    outcome = {
      error,
      grants: await grantCount(db, user.id, location),
      audits: (await grantAudits(db, user.id)).length,
      roles,
      location,
    };
    tx.rollback();
  });
  if (!outcome) throw new Error("F3.78: the moved-location case never ran");
  return outcome;
}

export async function assertTheServiceMapsTheWithCheckRefusalToANonNamingError(superDb: BmsDb): Promise<void> {
  const outcome = await addAfterTheLocationMoved(superDb);
  expect(outcome.roles).toEqual(["bms_tenant"]);
  expect(outcome.error).toBeInstanceOf(HttpException);
  const err = outcome.error as HttpException;
  expect([err.getStatus(), err.message]).toEqual([409, GRANT_TARGET_CHANGED]);
  expect(JSON.stringify(err.getResponse())).not.toContain(outcome.location);
}

export async function assertTheRefusedInsertLeavesNoGrantAndNoAuditRow(superDb: BmsDb): Promise<void> {
  const outcome = await addAfterTheLocationMoved(superDb);
  expect([outcome.grants, outcome.audits]).toEqual([0, 0]);
}

// -- (b) a delete under the wrong GUC -------------------------------------------

type Removed = { error: unknown; grantsAfter: number; audits: number; roles: string[]; rightGucDeleted: number };

/**
 * (b) The grant's location is ESKOM's when the service reads the grant and
 * PHEWB's when it deletes, so `withTenant(ESKOM)`'s `DELETE … RETURNING`
 * matches zero rows (the policy's `USING` filters; nothing raises). Positive
 * control: the same delete under PHEWB removes the row.
 */
async function removeAfterTheLocationMoved(superDb: BmsDb): Promise<Removed> {
  let outcome: Removed | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const caller = await insertUser(db, "admin", null);
    const user = await insertUser(db, "viewer", eskom);
    const location = await insertLocation(db, eskom);
    const [grant] = rowsOf<{ id: string }>(
      await db.execute(
        sql`INSERT INTO bms.user_location_access (user_id, location_id) VALUES (${user.id}, ${location}) RETURNING id`,
      ),
    );
    if (!grant) throw new Error("F3.78: the fixture grant was not inserted");
    const roles: string[] = [];
    const moveTheLocation = async (sp: BmsDb) => {
      await sp.execute(sql`UPDATE bms.locations SET organization_id = ${phewb} WHERE id = ${location}`);
    };
    const service = buildService(db, asTenant(db, roles, moveTheLocation));
    const error = await caught(service.remove(callerJwt(caller), user.id, "location", grant.id));
    const grantsAfter = await grantCount(db, user.id, location);
    const audits = (await grantAudits(db, user.id)).length;
    const deleted = await withTenant(asTenant(db, []), phewb, (sp) =>
      sp.execute(sql`DELETE FROM bms.user_location_access WHERE id = ${grant.id} RETURNING id`),
    );
    outcome = { error, grantsAfter, audits, roles, rightGucDeleted: rowsOf(deleted).length };
    tx.rollback();
  });
  if (!outcome) throw new Error("F3.78: the moved-grant case never ran");
  return outcome;
}

export async function assertADeleteUnderTheWrongGucIs404WithNoAudit(superDb: BmsDb): Promise<void> {
  const outcome = await removeAfterTheLocationMoved(superDb);
  expect(outcome.roles).toEqual(["bms_tenant"]);
  expect(outcome.error).toBeInstanceOf(HttpException);
  const err = outcome.error as HttpException;
  expect([err.getStatus(), err.message, outcome.grantsAfter, outcome.audits]).toEqual([404, GRANT_NOT_FOUND, 1, 0]);
}

export async function assertTheSameDeleteUnderTheRightGucRemovesTheRow(superDb: BmsDb): Promise<void> {
  const outcome = await removeAfterTheLocationMoved(superDb);
  expect(outcome.rightGucDeleted).toBe(1);
}

// -- F4.201: an asset-group grant names its location ---------------------------

/**
 * `F4.201`: the grants read joins the group's location, so the response names it. The fake db
 * returns whatever row the spec builds and cannot prove the SQL's join; this case runs it. The
 * location and the group carry different names, so `g.name` read as the location name fails.
 */
export async function assertAnAssetGroupGrantReadsItsLocationName(superDb: BmsDb): Promise<void> {
  let read: { locationName: string | undefined; expected: string } | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null);
    const user = await insertUser(db, "viewer", eskom);
    const location = await insertLocation(db, eskom);
    const [loc] = rowsOf<{ name: string }>(await db.execute(sql`SELECT name FROM bms.locations WHERE id = ${location}`));
    const groupId = randomUUID();
    await db.execute(sql`
      INSERT INTO bms.asset_groups (id, organization_id, location_id, code, name)
      VALUES (${groupId}, ${eskom}, ${location}, ${`f4201-${groupId.slice(0, 8)}`}, 'F4.201 group fixture')
    `);
    const service = buildService(db, asTenant(db, []));
    const { items } = await service.add(callerJwt(caller), user.id, { kind: "asset_group", targetId: groupId });
    read = { locationName: items.find((item) => item.targetId === groupId)?.locationName, expected: loc?.name ?? "missing" };
    tx.rollback();
  });
  if (!read) throw new Error("F4.201: the asset-group grant case never ran");
  expect(read.expected).toBe("F3.78 PR2 grants fixture");
  expect(read.locationName).toBe(read.expected);
}

type CrossOrgRead = { listed: boolean; hasLocationName: boolean };

/**
 * A group whose location is in another organization (a broken row): its grant is still listed —
 * so it stays visible and revocable — but it names no location, because the other
 * organization's location name is not the caller's to read through this join.
 */
async function readACrossOrganizationGroupGrant(superDb: BmsDb): Promise<CrossOrgRead> {
  let read: CrossOrgRead | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const caller = await insertUser(db, "admin", null);
    const user = await insertUser(db, "viewer", eskom);
    const elsewhere = await insertLocation(db, phewb);
    const groupId = randomUUID();
    await db.execute(sql`
      INSERT INTO bms.asset_groups (id, organization_id, location_id, code, name)
      VALUES (${groupId}, ${eskom}, ${elsewhere}, ${`f4201-${groupId.slice(0, 8)}`}, 'F4.201 cross-org group')
    `);
    await db.execute(sql`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES (${user.id}, ${groupId})`);
    const service = buildService(db, asTenant(db, []));
    const { items } = await service.list(callerJwt(caller), user.id);
    const item = items.find((i) => i.targetId === groupId);
    read = { listed: item !== undefined, hasLocationName: item !== undefined && "locationName" in item };
    tx.rollback();
  });
  if (!read) throw new Error("F4.201: the cross-organization group case never ran");
  return read;
}

export async function assertACrossOrganizationGroupGrantIsStillListed(superDb: BmsDb): Promise<void> {
  expect((await readACrossOrganizationGroupGrant(superDb)).listed).toBe(true);
}

export async function assertACrossOrganizationGroupGrantNamesNoLocation(superDb: BmsDb): Promise<void> {
  const read = await readACrossOrganizationGroupGrant(superDb);
  // Positive control: the row is there, so the absence below is the join's, not a missing row.
  expect(read.listed).toBe(true);
  expect(read.hasLocationName).toBe(false);
}
