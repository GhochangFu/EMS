import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { AssetGroupsAdminService } from "./asset-groups.service";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface against real,
 * non-owner roles.
 *
 * Every assertion below fails against the commit before this module existed:
 * there was no asset-group read in this API at all, and no way to set a role.
 *
 * **Constructed with real `bms_auth`/`bms_tenant`/`bms_fleet` connections**,
 * not the owner pool, for the reason `assets.service.rls.integration.test.ts`
 * records: `bms.asset_group_members` carries `tenant_isolation` **and**
 * `FORCE` through both parents (`0047` lines 223-240), so an owner connection
 * would pass whether or not the write is wrapped in `withTenant`.
 *
 * The fixtures are created by the suite and deleted afterwards rather than
 * borrowed from the seed. Two reasons: the ordering assertion needs insertion
 * order to differ from `assets.code` order, which a seeded group cannot
 * guarantee; and mutating a seeded membership would leave a role behind for
 * every other suite reading the same rows.
 */
export type GroupFixtures = {
  svc: AssetGroupsAdminService;
  ownerPool: pg.Pool;
  groupId: string;
  foreignGroupId: string;
  /** Membership ids, in the order the rows were INSERTed — deliberately not code order. */
  membershipIds: string[];
  /** A membership in `foreignGroupId`, for the scope refusal. */
  foreignMembershipId: string;
  /** A live role code, read from `bms.asset_roles` rather than hardcoded. */
  roleCode: string;
  secondRoleCode: string;
};

/** `list()` returns the caller's groups and never another location's. */
export async function assertListReturnsOnlyWritableGroups(
  ctx: GroupFixtures,
  scopedJwt: JwtPayload,
): Promise<void> {
  const { items } = await ctx.svc.list(scopedJwt);
  const ids = items.map((g) => g.id);

  expect(ids).toContain(ctx.groupId);
  expect(ids).not.toContain(ctx.foreignGroupId);

  // The count is part of the read, not decoration: the page uses it to show an
  // empty group without a second request.
  const mine = items.find((g) => g.id === ctx.groupId);
  expect(mine?.memberCount).toBe(ctx.membershipIds.length);
}

/**
 * `members()` orders by `assets.code`, not by insertion order.
 *
 * **This is the assertion that stops one stock template instantiated twice in
 * an organization from producing two different tile orders.** ADR 0049 put no
 * unique index on `(asset_group_id, role)`, so a role resolves to N bindings,
 * and N bindings with no total order is a layout that changes for no visible
 * reason. `assets.code` is `NOT NULL UNIQUE`, which is what makes it total.
 */
export async function assertMembersOrderedByAssetCode(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { items } = await ctx.svc.members(jwt, ctx.groupId);

  const codes = items.map((m) => m.assetCode);
  expect(codes).toEqual([...codes].sort());

  // Anti-vacuity: the fixture INSERTs in an order that is not code order, so a
  // service that returned rows unordered would fail above rather than pass by
  // luck. If this ever holds, the fixture stopped testing what it claims to.
  expect(items.map((m) => m.membershipId)).not.toEqual(ctx.membershipIds);
}

/**
 * `roleCounts` reports how many members carry each role.
 *
 * ADR 0049 decision 6 ruled "unresolved role → zero bindings → no data bound"
 * for match/no-match. With plural roles, two of three members carrying a role
 * renders a widget that looks right and is one short. Zero is visible;
 * N-minus-one is not, unless something counts it.
 */
export async function assertRoleCountsReportPluralRoles(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const [first, second] = ctx.membershipIds;
  await ctx.svc.setMemberRole(jwt, first as string, { role: ctx.roleCode });
  await ctx.svc.setMemberRole(jwt, second as string, { role: ctx.roleCode });

  const { roleCounts, items } = await ctx.svc.members(jwt, ctx.groupId);
  expect(roleCounts[ctx.roleCode]).toBe(2);

  // A member with no role contributes to no count — `null` is not a bucket.
  expect(Object.values(roleCounts).reduce((a, b) => a + b, 0)).toBe(2);
  expect(items.filter((m) => m.role === null).length).toBe(items.length - 2);

  await ctx.svc.setMemberRole(jwt, first as string, { role: null });
  await ctx.svc.setMemberRole(jwt, second as string, { role: null });
}

/** Sets a role on one membership and reads it back, with its label joined. */
export async function assertSetsRoleOnMembership(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const id = ctx.membershipIds[0] as string;
  const updated = await ctx.svc.setMemberRole(jwt, id, { role: ctx.roleCode });

  expect(updated.role).toBe(ctx.roleCode);
  // The label comes from the LEFT JOIN on `bms.asset_roles`, so a non-null role
  // must carry one — a null here would mean the join silently missed.
  expect(updated.roleLabel).toBeTruthy();

  // Read the column directly on the owner connection: the DTO could report a
  // value the write never committed if the tenant transaction rolled back.
  const [row] = (
    await ctx.ownerPool.query<{ role: string | null }>(
      "SELECT role FROM bms.asset_group_members WHERE id = $1",
      [id],
    )
  ).rows;
  expect(row?.role).toBe(ctx.roleCode);

  await ctx.svc.setMemberRole(jwt, id, { role: null });
}

/** `null` clears a role rather than being rejected as a missing value. */
export async function assertClearsRoleWithNull(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const id = ctx.membershipIds[1] as string;
  await ctx.svc.setMemberRole(jwt, id, { role: ctx.secondRoleCode });

  const cleared = await ctx.svc.setMemberRole(jwt, id, { role: null });
  expect(cleared.role).toBeNull();
  expect(cleared.roleLabel).toBeNull();

  const [row] = (
    await ctx.ownerPool.query<{ role: string | null }>(
      "SELECT role FROM bms.asset_group_members WHERE id = $1",
      [id],
    )
  ).rows;
  expect(row?.role).toBeNull();
}

/**
 * An unknown role code is a 400 naming the live codes, not the FK's 500.
 *
 * **This is the assertion that proves the vocabulary check runs in front of
 * `asset_group_members_role_fkey` rather than behind it.**
 */
export async function assertRejectsUnknownRoleWith400(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const id = ctx.membershipIds[0] as string;

  let caught: unknown;
  try {
    await ctx.svc.setMemberRole(jwt, id, { role: "f337-not-a-real-role" });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(BadRequestException);
  // Compared against a code read from the table, not a literal, so this does
  // not become a copy of migration 0051's seed.
  expect((caught as Error).message).toContain(ctx.roleCode);

  const [row] = (
    await ctx.ownerPool.query<{ role: string | null }>(
      "SELECT role FROM bms.asset_group_members WHERE id = $1",
      [id],
    )
  ).rows;
  expect(row?.role).toBeNull();
}

/** A retired role is refused too — existence is not enough. */
export async function assertRejectsRetiredRole(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const retired = `f337-retired-${Date.now()}`;
  await ctx.ownerPool.query(
    "INSERT INTO bms.asset_roles (code, label, active) VALUES ($1, $2, false)",
    [retired, "F3.37 retired test role"],
  );
  try {
    let caught: unknown;
    try {
      await ctx.svc.setMemberRole(jwt, ctx.membershipIds[0] as string, { role: retired });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
  } finally {
    await ctx.ownerPool.query("DELETE FROM bms.asset_roles WHERE code = $1", [retired]);
  }
}

/**
 * §4.7 — a membership in a location the caller cannot manage is refused.
 *
 * Without this a location-scoped admin could relabel another site's plant, and
 * the role is what a section template resolves through.
 */
export async function assertRefusesOutOfScopeMembership(
  ctx: GroupFixtures,
  scopedJwt: JwtPayload,
): Promise<void> {
  let caught: unknown;
  try {
    await ctx.svc.setMemberRole(scopedJwt, ctx.foreignMembershipId, { role: ctx.roleCode });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ForbiddenException);

  // And the read refuses too, not only the write — otherwise the page would
  // list a group it cannot edit.
  await expect(ctx.svc.members(scopedJwt, ctx.foreignGroupId)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
}

/** One audit row per successful write, with a real org and a resolved actor. */
export async function assertWritesAuditRow(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const id = ctx.membershipIds[2] as string;
  const before = Date.now();
  await ctx.svc.setMemberRole(jwt, id, { role: ctx.roleCode });

  const { rows } = await ctx.ownerPool.query<{
    organization_id: string | null;
    actor_id: string | null;
    payload: { from: string | null; to: string | null } | null;
  }>(
    `SELECT organization_id, actor_id, payload FROM bms.audit_log
      WHERE action = 'master.asset_group_member.role.set' AND entity_id = $1
        AND created_at >= $2
      ORDER BY created_at DESC LIMIT 1`,
    [id, new Date(before - 1000)],
  );

  expect(rows.length).toBe(1);
  // Non-null on both counts is the E7.1b/E7.1c lesson: the audit insert must
  // run on the same tenant transaction, and the actor lookup on `fleetDb`, or
  // one of these silently becomes NULL.
  expect(rows[0]?.organization_id).toBeTruthy();
  expect(rows[0]?.actor_id).toBeTruthy();
  expect(rows[0]?.payload?.to).toBe(ctx.roleCode);
  expect(rows[0]?.payload?.from).toBeNull();

  await ctx.svc.setMemberRole(jwt, id, { role: null });
}
