import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { AccessControlService } from "../auth/access-control.service";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { withTenant } from "../database/tenant-context";
import { CopilotAccessService } from "./copilot-access.service";
import { CopilotAvailabilityService } from "./copilot-availability.service";

/**
 * `F3.85` PR 3 / migration `0104` — what Postgres enforces on the three copilot
 * availability tables, and the two services reading and writing them for real.
 * `tests/f3.85-copilot-access-schema.test.ts` pins the migration text; this
 * file proves the boundary on a database. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */
export type CopilotAccessCtx = {
  /** `withTenant` runs on this — the `bms_tenant` role, bound by the policy. */
  tenantDb: BmsDb;
  /** Counts and fixture writes — `bms_fleet`, which bypasses RLS. */
  fleetPool: pg.Pool;
  /** `bms_owner` — the table owner, bound by the policy only through `FORCE`. */
  ownerPool: pg.Pool;
  /** The superuser — the only role that inserts and deletes a `bms.users` row under FORCE; fixtures only. */
  superPool: pg.Pool;
  orgA: string;
  orgB: string;
  /** A `location_admin` whose home organization is A. */
  userA: string;
  /** A `location_admin` whose home organization is B — an exception in A naming it survives A's user deletes. */
  userB: string;
  /**
   * The global admin who writes the switches — no home organization, so the
   * cascade case can delete A and its users while `updated_by` (no ON DELETE,
   * the 0100 model: users are deactivated, never deleted, ADR 0089) still
   * names a user that exists.
   */
  actorId: string;
};

const TABLES = ["copilot_org_settings", "copilot_role_settings", "copilot_user_overrides"] as const;

type PgLikeError = { code?: string; constraint?: string; message?: string };

function pgErrorOf(err: unknown): PgLikeError {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as PgLikeError & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

async function refusal(fn: () => Promise<unknown>, what: string): Promise<PgLikeError> {
  try {
    await fn();
  } catch (err) {
    return pgErrorOf(err);
  }
  throw new Error(`${what}: the write succeeded, and it must be refused`);
}

async function fleetCount(ctx: CopilotAccessCtx, table: string, organizationId: string): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.${table} WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0]?.n ?? -1;
}

/** 1 — positive control: A's tenant writes one row in each table. */
export async function aTenantWritesItsOwnRows(ctx: CopilotAccessCtx): Promise<void> {
  await withTenant(ctx.tenantDb, ctx.orgA, async (tx) => {
    await tx.execute(sql`INSERT INTO bms.copilot_org_settings (organization_id, enabled) VALUES (${ctx.orgA}, true)`);
    await tx.execute(
      sql`INSERT INTO bms.copilot_role_settings (organization_id, role, enabled) VALUES (${ctx.orgA}, 'location_admin', false)`,
    );
    await tx.execute(
      sql`INSERT INTO bms.copilot_user_overrides (organization_id, user_id, allow) VALUES (${ctx.orgA}, ${ctx.userA}, true)`,
    );
  });
  for (const table of TABLES) {
    expect(await fleetCount(ctx, table, ctx.orgA), `bms_fleet counts the ${table} row the tenant wrote`).toBe(1);
  }
}

/** 2 — B's tenant, a tenant with no GUC, and the owner under B's GUC all see none of A's rows. */
export async function noOtherSessionSeesAnOrganizationsRows(ctx: CopilotAccessCtx): Promise<void> {
  for (const table of TABLES) {
    const seen = await withTenant(ctx.tenantDb, ctx.orgB, (tx) =>
      tx.execute<{ organization_id: string }>(
        sql`SELECT organization_id FROM ${sql.raw(`bms.${table}`)} WHERE organization_id = ${ctx.orgA}`,
      ),
    );
    expect(seen.rows, `B's tenant must not see A's ${table} row`).toHaveLength(0);
    const unset = await ctx.tenantDb.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(`bms.${table}`)} WHERE organization_id = ${ctx.orgA}`,
    );
    expect(unset.rows[0]?.n, `a tenant session with no GUC sees no ${table} row`).toBe(0);
    expect(await fleetCount(ctx, table, ctx.orgA), "the row is there — the 0s above are the policy").toBe(1);
  }

  const client = await ctx.ownerPool.connect();
  try {
    const who = await client.query<{ u: string }>("SELECT current_user AS u");
    expect(who.rows[0]?.u, "the owner probe must run as the table owner").toBe("bms_owner");
    for (const table of TABLES) {
      const ownerCount = async (organizationId: string): Promise<number> => {
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('app.current_organization', $1, true)", [organizationId]);
          const { rows } = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM bms.${table} WHERE organization_id = $1`,
            [ctx.orgA],
          );
          return rows[0]?.n ?? -1;
        } finally {
          await client.query("ROLLBACK");
        }
      };
      expect(await ownerCount(ctx.orgA), `control: the owner under A's GUC sees A's ${table} row`).toBe(1);
      expect(await ownerCount(ctx.orgB), `the owner under B's GUC must see no ${table} row — FORCE`).toBe(0);
    }
  } finally {
    client.release();
  }
}

/** 3 — B's tenant cannot write a row for A (`WITH CHECK`). */
export async function aTenantCannotWriteAnotherOrganizationsRow(ctx: CopilotAccessCtx): Promise<void> {
  const error = await refusal(
    () =>
      withTenant(ctx.tenantDb, ctx.orgB, (tx) =>
        tx.execute(
          sql`INSERT INTO bms.copilot_role_settings (organization_id, role, enabled) VALUES (${ctx.orgA}, 'asset_group_admin', true)`,
        ),
      ),
    "B writing A's role switch",
  );
  expect(error.code, "42501 is the row-level security refusal").toBe("42501");
}

/** 4 — the role CHECK refuses a role that carries no switch. */
export async function aRoleWithNoSwitchIsRefused(ctx: CopilotAccessCtx): Promise<void> {
  for (const role of ["organization_admin", "operator"]) {
    const error = await refusal(
      () =>
        withTenant(ctx.tenantDb, ctx.orgA, (tx) =>
          tx.execute(
            sql`INSERT INTO bms.copilot_role_settings (organization_id, role, enabled) VALUES (${ctx.orgA}, ${role}, true)`,
          ),
        ),
      `a ${role} switch`,
    );
    expect(error.code, role).toBe("23514");
    expect(error.constraint, role).toBe("copilot_role_settings_role_check");
  }
}

function identityOf(ctx: CopilotAccessCtx, role: ResolvedIdentity["role"]): ResolvedIdentity {
  return {
    id: ctx.userA,
    email: "f385-a@example.test",
    displayName: "F3.85 A",
    role,
    organizationId: ctx.orgA,
    oidcSubject: null,
    disabledAt: null,
  } as ResolvedIdentity;
}

/**
 * 5 — the availability service reads the real rows: A's row says the role is
 * off and the user has an allow exception, so the user is available; B is
 * refused before a read.
 */
export async function theAvailabilityServiceReadsTheRealSwitches(ctx: CopilotAccessCtx): Promise<void> {
  const service = new CopilotAvailabilityService(ctx.tenantDb);
  expect(await service.decide(identityOf(ctx, "location_admin"), ctx.orgA)).toEqual({ available: true });
  expect(await service.decide(identityOf(ctx, "location_admin"), ctx.orgB)).toEqual({
    available: false,
    reason: "other_organization",
  });
  expect(await service.decide(identityOf(ctx, "admin"), ctx.orgB), "B has no switch row: off").toEqual({
    available: false,
    reason: "organization_off",
  });
}

/**
 * 6 — the access service writes through every conflict target, on both the
 * insert and the update branch: a role switch and an exception are each
 * written twice and stay one row, `allow: null` removes the exception, the
 * organization switch is inserted in B (which has no row yet) and updated in A,
 * and the DTO reads back what was written. The gate and the audit are faked
 * (the unit spec owns the gate); the SQL is real.
 */
export async function theAccessServiceWritesAndReadsBack(ctx: CopilotAccessCtx): Promise<void> {
  const audits: unknown[] = [];
  const accessControl = {
    requireMasterDataUser: async () => ({ id: ctx.actorId, role: "admin" }),
    isOrganizationLevelAdmin: async () => true,
  } as unknown as AccessControlService;
  const audit = { write: async (input: unknown) => void audits.push(input) } as unknown as MasterDataAuditService;
  const service = new CopilotAccessService(ctx.tenantDb, ctx.tenantDb, accessControl, audit);
  service.loadOverrideTarget = async () => ({ organizationId: ctx.orgA, role: "location_admin" });
  const admin = { sub: ctx.actorId, email: "f385-admin@example.test", role: "admin" } as JwtPayload;

  const first = await service.put(admin, ctx.orgA, { roles: { location_admin: true, asset_group_admin: false } });
  expect(first.roles).toEqual({ location_admin: true, asset_group_admin: false });
  const second = await service.put(admin, ctx.orgA, { roles: { asset_group_admin: true } });
  expect(second.roles).toEqual({ location_admin: true, asset_group_admin: true });
  expect(await fleetCount(ctx, "copilot_role_settings", ctx.orgA), "updated, not duplicated").toBe(2);

  // Case 1 left an allow row for userA; the override target is the composite (organization, user).
  await service.put(admin, ctx.orgA, { override: { userId: ctx.userA, allow: false } });
  const denied = await service.put(admin, ctx.orgA, { override: { userId: ctx.userA, allow: false } });
  expect(denied.overrides).toEqual([{ userId: ctx.userA, allow: false }]);
  expect(await fleetCount(ctx, "copilot_user_overrides", ctx.orgA), "updated, not duplicated").toBe(1);

  const cleared = await service.put(admin, ctx.orgA, { override: { userId: ctx.userA, allow: null } });
  expect(cleared.overrides).toEqual([]);
  expect(await fleetCount(ctx, "copilot_user_overrides", ctx.orgA)).toBe(0);

  // The insert branch of the organization switch: B has no row (case 5 read it as off).
  expect(await fleetCount(ctx, "copilot_org_settings", ctx.orgB)).toBe(0);
  const onB = await service.put(admin, ctx.orgB, { enabled: true });
  expect(onB.enabled).toBe(true);
  expect(await fleetCount(ctx, "copilot_org_settings", ctx.orgB)).toBe(1);

  // The update branch: A's row exists since case 1.
  const off = await service.put(admin, ctx.orgA, { enabled: false });
  expect(off.enabled).toBe(false);
  expect(await fleetCount(ctx, "copilot_org_settings", ctx.orgA)).toBe(1);
  expect(audits, "one audit row per PUT").toHaveLength(7);
}

/**
 * 7 — deleting the organization removes its three kinds of row. The exception
 * names userB, whose home is B, so deleting A's users does not remove it; only
 * the organization cascade can. Each table holds a row before the delete.
 */
export async function deletingTheOrganizationCascades(ctx: CopilotAccessCtx): Promise<void> {
  await withTenant(ctx.tenantDb, ctx.orgA, (tx) =>
    tx.execute(
      sql`INSERT INTO bms.copilot_user_overrides (organization_id, user_id, allow) VALUES (${ctx.orgA}, ${ctx.userB}, true)`,
    ),
  );
  for (const table of TABLES) {
    expect(await fleetCount(ctx, table, ctx.orgA), `control: ${table} holds a row for A`).toBeGreaterThan(0);
  }
  await ctx.superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [ctx.orgA]);
  expect(await fleetCount(ctx, "copilot_user_overrides", ctx.orgA), "userB's exception outlives A's users").toBe(1);
  await ctx.fleetPool.query("DELETE FROM bms.organizations WHERE id = $1", [ctx.orgA]);
  for (const table of TABLES) {
    expect(await fleetCount(ctx, table, ctx.orgA), `${table} cascades`).toBe(0);
  }
}
