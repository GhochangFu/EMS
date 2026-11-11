import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect, vi } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { directOrganizationIds, scopeFromSource } from "../../auth/access-scope-sources";
import { rememberIdentity } from "../../auth/identity-resolver";
import { withTenant } from "../../database/tenant-context";
import type { NewIdentityUser } from "../../identity/identity-admin.client";
import { FakeIdentityAdmin } from "../../identity/testing/fake-identity-admin";
import { withRollback } from "../../testing/with-rollback";
import { MasterDataAuditService } from "../master-data-audit.service";
import { CHANGED_UNDER_YOU, updateUserRow, UsersService } from "./users.service";

/**
 * `F3.78` / ADR 0089 decisions 2, 3, 7, 8 — `UsersService` driving its own
 * statements on the real pool roles. A fake proves neither the column grants
 * `0098` gives `bms_tenant`/`bms_fleet` nor the `0048` policy's strict
 * `WITH CHECK`, and both decide whether a write lands.
 *
 * **The rollback cases** run inside `withRollback` on the superuser pool and
 * call `tx.rollback()` (`tests/f3.60-withrollback-cases-roll-back.test.ts`).
 * The case inserts its own users as the superuser, then hands the service two
 * wrappers of that transaction ({@link asRole}): each service transaction
 * becomes a savepoint that switches to `bms_tenant` or `bms_fleet` with
 * `SET LOCAL ROLE` and records `current_user`, so the service's statements run
 * as the pool role they run as in production. A linked fixture's subject is
 * never committed.
 *
 * **The last-admin `55P03` cases** need a second connection, so they commit
 * their fixtures (`f3.78-pr2-<uuid>@fixture.local`) and delete them as the
 * superuser in `finally`; the last case asserts nothing leaked.
 */

const PASSWORD = "Temp-Pass-123";

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows;

/** `FakeIdentityAdmin` with a unique Keycloak id per create, so no subject can collide with another row. */
class UniqueIdentityAdmin extends FakeIdentityAdmin {
  readonly createdIds: string[] = [];
  override async createUser(user: NewIdentityUser): Promise<{ id: string }> {
    await super.createUser(user);
    const id = `f3.78-pr2-kc-${randomUUID()}`;
    this.createdIds.push(id);
    return { id };
  }
}

/**
 * `tx`, except that `transaction(fn)` opens a savepoint, switches to `role`,
 * records `current_user` into `roles`, runs `fn`, and switches back. A failed
 * `fn` rolls the savepoint back, which undoes the `SET LOCAL ROLE` with it.
 * `beforeWrite` runs as the superuser on `tx` before the savepoint opens (the
 * wrong-GUC case moves the row there), so a failed `fn` does not undo it.
 */
function asRole(
  tx: BmsDb,
  role: "bms_tenant" | "bms_fleet",
  roles: string[],
  beforeWrite?: (sp: BmsDb) => Promise<void>,
): BmsDb {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return async (fn: (sp: unknown) => Promise<unknown>) => {
          // On the enclosing transaction, before the savepoint: a failed `fn` must not undo it.
          if (beforeWrite) await beforeWrite(target);
          return target.transaction(async (sp) => {
            await sp.execute(sql.raw(`SET LOCAL ROLE ${role}`));
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

type Fixture = { id: string; email: string; subject: string | null; role: UserRole; organizationId: string | null };

async function insertUser(
  db: Pick<BmsDb, "execute">,
  role: UserRole,
  organizationId: string | null,
  linked: boolean,
): Promise<Fixture> {
  const id = randomUUID();
  const email = `f3.78-pr2-${id}@fixture.local`;
  const subject = linked ? `f3.78-pr2-sub-${id}` : null;
  await db.execute(sql`
    INSERT INTO bms.users (id, organization_id, email, display_name, role, oidc_subject)
    VALUES (${id}, ${organizationId}, ${email}, 'F3.78 PR2 fixture', ${role}, ${subject})
  `);
  return { id, email, subject, role, organizationId };
}

async function organizationId(db: Pick<BmsDb, "execute">, code: string): Promise<string> {
  const [row] = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM bms.organizations WHERE code = ${code}`));
  if (!row) throw new Error(`F3.78: organization ${code} is missing — run pnpm db:seed`);
  return row.id;
}

function callerJwt(caller: Fixture): JwtPayload {
  const jwt: JwtPayload = { sub: caller.subject ?? caller.id, email: caller.email, name: "F3.78 caller", role: caller.role };
  rememberIdentity(jwt, {
    id: caller.id,
    email: caller.email,
    displayName: "F3.78 caller",
    role: caller.role,
    organizationId: caller.organizationId,
    oidcSubject: caller.subject,
    disabledAt: null,
  });
  return jwt;
}

function buildService(fleetDb: BmsDb, tenantDb: BmsDb, identity: FakeIdentityAdmin): UsersService {
  vi.stubEnv("AUTH_MODE", "oidc");
  const accessControl = { writableOrganizationIds: async () => null } as unknown as AccessControlService;
  return new UsersService(fleetDb, tenantDb, accessControl, new MasterDataAuditService(tenantDb, fleetDb), identity);
}

type UserState = { role: string; organization_id: string | null; oidc_subject: string | null; disabled_at: Date | null };

async function readUser(db: Pick<BmsDb, "execute">, id: string): Promise<UserState | undefined> {
  const [row] = rowsOf<UserState>(
    await db.execute(sql`SELECT role, organization_id, oidc_subject, disabled_at FROM bms.users WHERE id = ${id}`),
  );
  return row;
}

// -- rollback cases ---------------------------------------------------------

type Landed = { roles: string[]; row: UserState | undefined; subject: string | undefined };

async function createThroughTheService(superDb: BmsDb, role: UserRole): Promise<Landed> {
  let landed: Landed | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const roles: string[] = [];
    const identity = new UniqueIdentityAdmin();
    const service = buildService(asRole(db, "bms_fleet", roles), asRole(db, "bms_tenant", roles), identity);
    const response = await service.create(callerJwt(caller), {
      email: `f3.78-pr2-${randomUUID()}@fixture.local`,
      displayName: "F3.78 PR2 created",
      role,
      organizationId: role === "admin" ? null : eskom,
      temporaryPassword: PASSWORD,
    });
    landed = { roles, row: await readUser(db, response.user.id), subject: identity.createdIds[0] };
    tx.rollback();
  });
  if (!landed) throw new Error("F3.78: the create case never ran");
  return landed;
}

/** `UsersService.create` of a viewer: the raw insert lands on `bms_tenant` under `withTenant`. */
export async function assertCreateInsertLandsOnTheTenantRole(superDb: BmsDb): Promise<void> {
  const landed = await createThroughTheService(superDb, "viewer");
  expect(landed.roles).toEqual(["bms_tenant"]);
  expect(landed.row?.oidc_subject).toBe(landed.subject);
}

/** `UsersService.create` of an admin: the insert lands on `bms_fleet` with `organization_id NULL`. */
export async function assertAdminCreateInsertLandsOnTheFleetRole(superDb: BmsDb): Promise<void> {
  const landed = await createThroughTheService(superDb, "admin");
  expect(landed.roles).toEqual(["bms_fleet"]);
  expect([landed.row?.role, landed.row?.organization_id]).toEqual(["admin", null]);
}

async function changeRoleThroughTheService(
  superDb: BmsDb,
  from: UserRole,
  body: { role: UserRole; organizationId: string | null } | "eskom",
): Promise<Landed> {
  let landed: Landed | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const target = await insertUser(db, from, from === "admin" ? null : eskom, true);
    const roles: string[] = [];
    const service = buildService(asRole(db, "bms_fleet", roles), asRole(db, "bms_tenant", roles), new UniqueIdentityAdmin());
    await service.update(
      callerJwt(caller),
      target.id,
      body === "eskom" ? { role: "viewer", organizationId: eskom } : body,
    );
    landed = { roles, row: await readUser(db, target.id), subject: target.subject ?? undefined };
    tx.rollback();
  });
  if (!landed) throw new Error("F3.78: the role-change case never ran");
  return landed;
}

export async function assertPromotionToAdminRunsOnTheFleetRole(superDb: BmsDb): Promise<void> {
  const landed = await changeRoleThroughTheService(superDb, "viewer", { role: "admin", organizationId: null });
  expect(landed.roles).toEqual(["bms_fleet"]);
  expect([landed.row?.role, landed.row?.organization_id]).toEqual(["admin", null]);
}

export async function assertDemotionFromAdminRunsOnTheFleetRole(superDb: BmsDb): Promise<void> {
  const landed = await changeRoleThroughTheService(superDb, "admin", "eskom");
  expect(landed.roles).toEqual(["bms_fleet"]);
  expect(landed.row?.role).toBe("viewer");
  expect(landed.row?.organization_id).not.toBeNull();
}

type WrongGuc = { error: unknown; audits: number; rightGucUpdated: boolean; disabledAt: Date | null | undefined };

/**
 * Deactivate under a GUC that no longer matches the row: the row moves to
 * another organization between the service's read and its write (the
 * superuser moves it at the start of the service's transaction), so the
 * service's `withTenant(old organization)` `UPDATE … RETURNING` matches zero
 * rows. The positive control: the same statement under the row's organization
 * updates it.
 */
async function deactivateUnderTheWrongGuc(superDb: BmsDb): Promise<WrongGuc> {
  let outcome: WrongGuc | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const phewb = await organizationId(db, "PHEWB");
    const caller = await insertUser(db, "admin", null, false);
    const target = await insertUser(db, "viewer", eskom, true);
    const roles: string[] = [];
    const moveTheRow = async (sp: BmsDb) => {
      await sp.execute(sql`UPDATE bms.users SET organization_id = ${phewb} WHERE id = ${target.id}`);
    };
    const service = buildService(
      asRole(db, "bms_fleet", roles),
      asRole(db, "bms_tenant", roles, moveTheRow),
      new UniqueIdentityAdmin(),
    );
    let error: unknown = null;
    try {
      await service.deactivate(callerJwt(caller), target.id);
    } catch (err) {
      error = err;
    }
    const [count] = rowsOf<{ n: number }>(
      await db.execute(sql`SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_id = ${target.id}`),
    );
    let rightGucUpdated = false;
    await withTenant(asRole(db, "bms_tenant", []), phewb, async (sp) => {
      await updateUserRow(sp, target.id, { disabledAt: sql`now()` });
      rightGucUpdated = true;
    });
    outcome = {
      error,
      audits: count?.n ?? -1,
      rightGucUpdated,
      disabledAt: (await readUser(db, target.id))?.disabled_at,
    };
    tx.rollback();
  });
  if (!outcome) throw new Error("F3.78: the wrong-GUC case never ran");
  return outcome;
}

export async function assertDeactivateUnderTheWrongGucIsRefusedWithNoAudit(superDb: BmsDb): Promise<void> {
  const outcome = await deactivateUnderTheWrongGuc(superDb);
  expect(outcome.rightGucUpdated, "positive control: the same statement under the row's organization updates it").toBe(true);
  expect((outcome.error as Error | null)?.message).toBe(CHANGED_UNDER_YOU);
  expect(outcome.audits).toBe(0);
}

// -- F4.340 / ADR 0128: an organization admin holds its home organization ---

type HomeGrant = {
  roles: string[];
  grantOrganizations: string[];
  readLocations: number;
  foreignReadLocations: number;
  eskomLocations: number;
  grantAudits: { organization_id: string | null; payload: Record<string, unknown> }[];
  userAudits: string[];
  home: string;
};

/** What the scope readers see for `userId`, and the audit rows about it, read on the superuser `db`. */
async function readHomeGrant(db: BmsDb, userId: string, role: UserRole, home: string, roles: string[]): Promise<HomeGrant> {
  const grantOrganizations = await directOrganizationIds(db, userId);
  const scope = await scopeFromSource(db, { id: userId, role }, "organization");
  const ids = scope.locations.map((location) => location.id);
  const foreign = ids.length === 0
    ? []
    : rowsOf<{ id: string }>(
        await db.execute(sql`SELECT id FROM bms.locations WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND organization_id <> ${home}`),
      );
  const [eskom] = rowsOf<{ n: number }>(
    await db.execute(sql`SELECT count(*)::int AS n FROM bms.locations WHERE organization_id = ${home} AND active`),
  );
  const grantAudits = rowsOf<{ organization_id: string | null; payload: Record<string, unknown> }>(
    await db.execute(sql`
      SELECT organization_id, payload FROM bms.audit_log
       WHERE action = 'master.user_grant.add' AND payload->>'userId' = ${userId}
    `),
  );
  const userAudits = rowsOf<{ action: string }>(
    await db.execute(sql`SELECT action FROM bms.audit_log WHERE entity_id = ${userId} ORDER BY action`),
  ).map((row) => row.action);
  return {
    roles,
    grantOrganizations,
    readLocations: ids.length,
    foreignReadLocations: foreign.length,
    eskomLocations: eskom?.n ?? 0,
    grantAudits,
    userAudits,
    home,
  };
}

async function createAndReadHomeGrant(superDb: BmsDb, role: UserRole): Promise<HomeGrant> {
  let outcome: HomeGrant | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const roles: string[] = [];
    const service = buildService(asRole(db, "bms_fleet", roles), asRole(db, "bms_tenant", roles), new UniqueIdentityAdmin());
    const response = await service.create(callerJwt(caller), {
      email: `f3.78-pr2-${randomUUID()}@fixture.local`,
      displayName: "F4.340 created",
      role,
      organizationId: eskom,
      temporaryPassword: PASSWORD,
    });
    outcome = await readHomeGrant(db, response.user.id, role, eskom, roles);
    tx.rollback();
  });
  if (!outcome) throw new Error("F4.340: the create case never ran");
  return outcome;
}

/**
 * The defect: before ADR 0128 a created `organization_admin` had no
 * `user_organization_access` row, so `directOrganizationIds` was `[]` and the
 * organization read scope held no location. Now the grant lands on
 * `bms_tenant` in the create transaction, with its own audit row.
 */
export async function assertACreatedOrganizationAdminHoldsItsHomeOrganization(superDb: BmsDb): Promise<void> {
  const outcome = await createAndReadHomeGrant(superDb, "organization_admin");
  expect(outcome.roles).toEqual(["bms_tenant"]);
  expect(outcome.grantOrganizations).toEqual([outcome.home]);
  expect(outcome.eskomLocations, "fixture: the seeded ESKOM organization has active locations").toBeGreaterThan(0);
  expect(outcome.readLocations).toBeGreaterThan(0);
  expect(outcome.foreignReadLocations).toBe(0);
  expect(outcome.userAudits).toEqual(["master.user.create"]);
  expect(outcome.grantAudits).toHaveLength(1);
  expect(outcome.grantAudits[0]?.organization_id).toBe(outcome.home);
  expect(outcome.grantAudits[0]?.payload).toMatchObject({
    kind: "organization",
    targetId: outcome.home,
    reason: "home_organization",
  });
}

/** ADR 0128 decision 4: a `viewer` gets no automatic grant. */
export async function assertACreatedViewerGetsNoGrant(superDb: BmsDb): Promise<void> {
  const outcome = await createAndReadHomeGrant(superDb, "viewer");
  expect(outcome.grantOrganizations).toEqual([]);
  expect(outcome.grantAudits).toEqual([]);
}

async function changeRoleAndReadHomeGrant(
  superDb: BmsDb,
  from: UserRole,
  to: UserRole,
  existingGrant: boolean,
): Promise<HomeGrant> {
  let outcome: HomeGrant | undefined;
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const target = await insertUser(db, from, eskom, true);
    if (existingGrant) {
      await db.execute(sql`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES (${target.id}, ${eskom})`);
    }
    const roles: string[] = [];
    const service = buildService(asRole(db, "bms_fleet", roles), asRole(db, "bms_tenant", roles), new UniqueIdentityAdmin());
    await service.update(callerJwt(caller), target.id, { role: to });
    outcome = await readHomeGrant(db, target.id, to, eskom, roles);
    tx.rollback();
  });
  if (!outcome) throw new Error("F4.340: the role-change case never ran");
  return outcome;
}

/** ADR 0128 decision 2: a promotion to `organization_admin` adds the home grant, audited. */
export async function assertAPromotionToOrganizationAdminAddsTheHomeGrant(superDb: BmsDb): Promise<void> {
  const outcome = await changeRoleAndReadHomeGrant(superDb, "viewer", "organization_admin", false);
  expect(outcome.roles).toEqual(["bms_tenant"]);
  expect(outcome.grantOrganizations).toEqual([outcome.home]);
  expect(outcome.readLocations).toBeGreaterThan(0);
  expect(outcome.grantAudits).toHaveLength(1);
  expect(outcome.grantAudits[0]?.payload).toMatchObject({ reason: "home_organization" });
}

/** A promotion when the grant already exists adds no second row and no grant audit row. */
export async function assertAPromotionWithTheGrantAddsNothing(superDb: BmsDb): Promise<void> {
  const outcome = await changeRoleAndReadHomeGrant(superDb, "viewer", "organization_admin", true);
  expect(outcome.grantOrganizations).toEqual([outcome.home]);
  expect(outcome.grantAudits).toEqual([]);
  expect(outcome.userAudits).toEqual(["master.user.update"]);
}

/** A demotion keeps the grant (F3.78 plan D2). */
export async function assertADemotionKeepsTheHomeGrant(superDb: BmsDb): Promise<void> {
  const outcome = await changeRoleAndReadHomeGrant(superDb, "organization_admin", "viewer", true);
  expect(outcome.grantOrganizations).toEqual([outcome.home]);
  expect(outcome.grantAudits).toEqual([]);
}

/** ADR 0128 Q6: the list's `hasEffectiveGrant`, on the real tables. */
export async function assertTheListFlagsAUserWithNoGrant(superDb: BmsDb): Promise<void> {
  let flags: (boolean | undefined)[] = [];
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const service = buildService(asRole(db, "bms_fleet", []), asRole(db, "bms_tenant", []), new UniqueIdentityAdmin());
    const orgAdmin = await service.create(callerJwt(caller), {
      email: `f3.78-pr2-${randomUUID()}@fixture.local`,
      displayName: "F4.340 org admin",
      role: "organization_admin",
      organizationId: eskom,
      temporaryPassword: PASSWORD,
    });
    const viewer = await insertUser(db, "viewer", eskom, true);
    const { items } = await service.list(callerJwt(caller));
    const flag = (id: string) => items.find((item) => item.id === id)?.hasEffectiveGrant;
    flags = [flag(caller.id), flag(orgAdmin.user.id), flag(viewer.id)];
    tx.rollback();
  });
  expect(flags).toEqual([true, true, false]);
}

/**
 * Code review F4.340: the location and asset-group branches of the flag, and
 * the active-site rule. A grant counts only when it reaches an active
 * location, as the Grants drawer's `effective` does.
 */
export async function assertTheListFlagFollowsEachGrantKindAndTheActiveRule(superDb: BmsDb): Promise<void> {
  let flags: Record<string, boolean | undefined> = {};
  await withRollback(superDb, async (tx) => {
    const db = tx as unknown as BmsDb;
    const eskom = await organizationId(db, "ESKOM");
    const caller = await insertUser(db, "admin", null, false);
    const [active, inactive] = rowsOf<{ id: string }>(
      await db.execute(sql`
        SELECT l.id FROM bms.locations l
         WHERE l.organization_id = ${eskom} AND l.active
           AND EXISTS (SELECT 1 FROM bms.asset_groups g WHERE g.location_id = l.id)
         ORDER BY l.id LIMIT 2
      `),
    );
    if (!active || !inactive) throw new Error("F4.340: the seed needs two active ESKOM locations with asset groups");
    await db.execute(sql`UPDATE bms.locations SET active = false WHERE id = ${inactive.id}`);
    const [group] = rowsOf<{ id: string }>(
      await db.execute(sql`SELECT id FROM bms.asset_groups WHERE location_id = ${active.id} LIMIT 1`),
    );
    const [deadGroup] = rowsOf<{ id: string }>(
      await db.execute(sql`SELECT id FROM bms.asset_groups WHERE location_id = ${inactive.id} LIMIT 1`),
    );
    const locationAdmin = await insertUser(db, "location_admin", eskom, true);
    const groupAdmin = await insertUser(db, "asset_group_admin", eskom, true);
    const operator = await insertUser(db, "operator", eskom, true);
    const deadLocationAdmin = await insertUser(db, "location_admin", eskom, true);
    const deadGroupAdmin = await insertUser(db, "asset_group_admin", eskom, true);
    const wrongKind = await insertUser(db, "location_admin", eskom, true);
    await db.execute(sql`INSERT INTO bms.user_location_access (user_id, location_id) VALUES
      (${locationAdmin.id}, ${active.id}), (${operator.id}, ${active.id}), (${deadLocationAdmin.id}, ${inactive.id})`);
    await db.execute(sql`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES
      (${groupAdmin.id}, ${group?.id}), (${deadGroupAdmin.id}, ${deadGroup?.id})`);
    await db.execute(sql`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES (${wrongKind.id}, ${eskom})`);
    const service = buildService(asRole(db, "bms_fleet", []), asRole(db, "bms_tenant", []), new UniqueIdentityAdmin());
    const { items } = await service.list(callerJwt(caller));
    const flag = (id: string) => items.find((item) => item.id === id)?.hasEffectiveGrant;
    flags = {
      locationAdmin: flag(locationAdmin.id),
      groupAdmin: flag(groupAdmin.id),
      operator: flag(operator.id),
      deadLocationAdmin: flag(deadLocationAdmin.id),
      deadGroupAdmin: flag(deadGroupAdmin.id),
      wrongKind: flag(wrongKind.id),
    };
    tx.rollback();
  });
  expect(flags).toEqual({
    locationAdmin: true,
    groupAdmin: true,
    operator: true,
    deadLocationAdmin: false,
    deadGroupAdmin: false,
    wrongKind: false,
  });
}

// -- the last-admin lock: committed fixtures, a second connection -----------

export type LockPools = { superPool: pg.Pool; fleetPool: pg.Pool };

/** The real fleet pool, whose every service transaction first sets a 200 ms lock timeout. */
function withLockTimeout(db: BmsDb): BmsDb {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lock_timeout = '200ms'`);
            return fn(tx);
          });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function cleanUp(superPool: pg.Pool, ids: string[]): Promise<void> {
  await superPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[]) OR actor_id = ANY($1::uuid[])`, [ids]);
  await superPool.query(`DELETE FROM bms.users WHERE id = ANY($1::uuid[])`, [ids]);
}

/**
 * Client A locks only an admin row that is NOT the target (nor the caller), and
 * the service then demotes or deactivates the target on a second connection.
 * With `FOR UPDATE` on every active admin row, the service's lock waits on
 * client A and fails with `55P03` after 200 ms; without it, the target row is
 * unlocked and the write would go through.
 */
async function lockedAdminWrite(
  pools: LockPools,
  write: (service: UsersService, jwt: JwtPayload, targetId: string, eskom: string) => Promise<unknown>,
): Promise<{ error: unknown; keycloakCalls: number }> {
  const superDb = createDb(pools.superPool);
  const eskom = await organizationId(superDb, "ESKOM");
  const target = await insertUser(superDb, "admin", null, true);
  const caller = await insertUser(superDb, "admin", null, true);
  // A third admin, neither the target nor the caller: the audit row's actor_id FK takes
  // FOR KEY SHARE on the caller's row, so locking the caller would block the write for a
  // reason that has nothing to do with the last-admin lock.
  const locked = await insertUser(superDb, "admin", null, true);
  const clientA = await pools.superPool.connect();
  try {
    await clientA.query("BEGIN");
    await clientA.query("SELECT id FROM bms.users WHERE id = $1 FOR UPDATE", [locked.id]);
    const identity = new UniqueIdentityAdmin();
    const fleetDb = withLockTimeout(createDb(pools.fleetPool));
    const service = buildService(fleetDb, fleetDb, identity);
    let error: unknown = null;
    try {
      await write(service, callerJwt(caller), target.id, eskom);
    } catch (err) {
      error = err;
    }
    return { error, keycloakCalls: identity.calls.length };
  } finally {
    await clientA.query("ROLLBACK").catch(() => undefined);
    clientA.release();
    await cleanUp(pools.superPool, [target.id, caller.id, locked.id]);
  }
}

const sqlState = (err: unknown): string | undefined =>
  (err as { code?: string } | null)?.code ?? (err as { cause?: { code?: string } } | null)?.cause?.code;

export async function assertDemotingAnAdminWaitsOnTheLastAdminLock(pools: LockPools): Promise<void> {
  const outcome = await lockedAdminWrite(pools, (service, jwt, id, eskom) =>
    service.update(jwt, id, { role: "viewer", organizationId: eskom }),
  );
  expect(sqlState(outcome.error)).toBe("55P03");
  expect(outcome.keycloakCalls, "the lock comes before the Keycloak mirror").toBe(0);
}

export async function assertDeactivatingAnAdminWaitsOnTheLastAdminLock(pools: LockPools): Promise<void> {
  const outcome = await lockedAdminWrite(pools, (service, jwt, id) => service.deactivate(jwt, id));
  expect(sqlState(outcome.error)).toBe("55P03");
  expect(outcome.keycloakCalls, "the lock comes before the Keycloak calls").toBe(0);
}

export async function assertNoCommittedFixtureLeaked(superPool: pg.Pool): Promise<void> {
  const { rows } = await superPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.users WHERE email LIKE 'f3.78-pr2-%@fixture.local'`,
  );
  expect(rows[0]?.n).toBe(0);
}
