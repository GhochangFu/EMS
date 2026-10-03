import { randomUUID } from "node:crypto";

import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../master-data-audit.service";
import type { AuditInput } from "../master-data-audit.service";
import type { AssetGroupsAdminService } from "./asset-groups.service";

/** A fixture asset the F3.78 cases create, so the 400s can prove they name none of it. */
export type FixtureAsset = { id: string; code: string; name: string };

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
  /**
   * Every role code an assertion INSERTs, so `afterAll` can delete **exactly
   * those** rows.
   *
   * `bms.asset_roles` is global — no `organization_id`, no RLS — so a leaked
   * fixture row is visible to every organization, and one did leak: an earlier
   * run left `f337-retired-…` behind and the table read 27 rows against the
   * plan's expected 26. The `finally` below is not containment, because an
   * aborted run never reaches it.
   *
   * Exact codes, never a `LIKE 'f337-%'` sweep:
   * `tests/integration-fixture-isolation.test.ts` fails that, and correctly —
   * two parallel instances of this file would delete each other's rows.
   */
  createdRoleCodes: string[];
  /** F3.78 — the scoped caller's own site, and the organization that owns it. */
  scopedLocationId: string;
  scopedOrganizationId: string;
  /** F3.78 — another organization's location, and the asset behind `foreignMembershipId`. */
  foreignLocationId: string;
  foreignOrganizationId: string;
  foreignAsset: FixtureAsset;
  /** F3.78 — an asset at a fixture location of the SAME organization as `groupId`, but not its location. */
  otherLocationAsset: FixtureAsset;
  /** F3.78 — a fresh asset at a location; `active` false stages a retired one. Registered for cleanup. */
  makeAsset: (locationId: string, organizationId: string, active: boolean) => Promise<FixtureAsset>;
  /** F3.78 — ids the service created, so `afterAll` deletes exactly those. */
  createdGroupIds: string[];
  createdMembershipIds: string[];
  /** F3.78 — the same service with an audit write that fails after its insert. */
  rollbackSvc: AssetGroupsAdminService;
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
  // Registered before the INSERT, so an abort between the two still leaves
  // `afterAll` a code to delete. The `finally` below is the fast path, not the
  // guarantee.
  ctx.createdRoleCodes.push(retired);
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

// ---------------------------------------------------------------------------
// F3.78 (ADR 0089 decision 7, plan U8) — the four asset-group write routes.
//
// Every case that commits uses a `f378-pr4-<uuid>` code and registers the id it
// creates in `ctx`, so `afterAll` deletes exactly those rows and then proves
// none is left. Cases that must not write assert it on the owner connection.
// ---------------------------------------------------------------------------

/** What the rollback audit service throws AFTER its insert ran. */
export const AUDIT_SENTINEL = "f378-pr4 audit ran, then the write fails";

/**
 * Wraps the real audit write and fails after it. Its own default executor is
 * the fleet pool (BYPASSRLS), so a service that forgot to hand over its `tx`
 * would COMMIT the audit row on that pool instead of failing — and the count in
 * `assertAuditRollsBackWithTheWrite` would be 1, not 0.
 */
export class RollbackAuditService extends MasterDataAuditService {
  override async write(input: AuditInput, executor?: BmsDb): Promise<void> {
    await super.write(input, executor);
    throw new Error(AUDIT_SENTINEL);
  }
}

function uniqueCode(): string {
  return `f378-pr4-${randomUUID()}`;
}

async function count(ctx: GroupFixtures, sqlText: string, params: unknown[]): Promise<number> {
  const { rows } = await ctx.ownerPool.query<{ n: string }>(sqlText, params);
  return Number(rows[0]?.n);
}

async function auditRows(ctx: GroupFixtures, action: string, entityId: string) {
  const { rows } = await ctx.ownerPool.query<{
    organization_id: string | null;
    actor_id: string | null;
    payload: Record<string, unknown> | null;
  }>(
    "SELECT organization_id, actor_id, payload FROM bms.audit_log WHERE action = $1 AND entity_id = $2",
    [action, entityId],
  );
  return rows;
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused");
}

function bodyOf(err: unknown): string {
  return JSON.stringify((err as HttpException).getResponse());
}

/** A refusal body names no row of the other site: no id, code or name. */
function expectNamesNone(err: unknown, secrets: readonly string[]): void {
  const text = bodyOf(err);
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

async function createGroup(ctx: GroupFixtures, jwt: JwtPayload, locationId: string) {
  const group = await ctx.svc.create(jwt, { locationId, code: uniqueCode(), name: "F3.78 pr4 group" });
  ctx.createdGroupIds.push(group.id);
  return group;
}

/** A second group at the same location and code is a 409 and writes no second row. */
export async function assertDuplicateGroupCodeIs409(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const code = uniqueCode();
  const body = { locationId: ctx.scopedLocationId, code, name: "F3.78 pr4 dup" };
  ctx.createdGroupIds.push((await ctx.svc.create(jwt, body)).id);

  const err = await rejection(() => ctx.svc.create(jwt, body));
  expect(err).toBeInstanceOf(ConflictException);
  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE location_id = $1 AND code = $2", [
      ctx.scopedLocationId,
      code,
    ]),
  ).toBe(1);
}

/** An unknown domain is a 400 naming the live codes, not the foreign key's 500. */
export async function assertCreateRejectsAnUnknownDomain(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const code = uniqueCode();
  const err = await rejection(() =>
    ctx.svc.create(jwt, { locationId: ctx.scopedLocationId, code, name: "X", domain: "f378-not-a-domain" }),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect(await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE code = $1", [code])).toBe(0);
}

/** A member whose asset sits at another location of the SAME organization is a 400 naming no asset. */
export async function assertMemberFromOtherLocationIs400(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = ctx.otherLocationAsset;
  const err = await rejection(() => ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id }));
  expect(err).toBeInstanceOf(BadRequestException);
  expectNamesNone(err, [asset.id, asset.code, asset.name]);
  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_group_members WHERE asset_id = $1", [asset.id]),
  ).toBe(0);
}

/** An asset of another ORGANIZATION is refused the same way. */
export async function assertMemberFromOtherOrganizationIs400(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = ctx.foreignAsset;
  const err = await rejection(() => ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id }));
  expect(err).toBeInstanceOf(BadRequestException);
  expectNamesNone(err, [asset.id, asset.code, asset.name]);
}

/** A retired asset at the right location is refused too. */
export async function assertInactiveAssetIs400(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, false);
  const err = await rejection(() => ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id }));
  expect(err).toBeInstanceOf(BadRequestException);
  expectNamesNone(err, [asset.id, asset.code]);
}

/** The same asset twice in one group is a 409 and leaves one row. */
export async function assertDuplicateMemberIs409(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const first = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id });
  ctx.createdMembershipIds.push(first.membershipId);

  const err = await rejection(() => ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id }));
  expect(err).toBeInstanceOf(ConflictException);
  expect(
    await count(
      ctx,
      "SELECT count(*) AS n FROM bms.asset_group_members WHERE asset_group_id = $1 AND asset_id = $2",
      [ctx.groupId, asset.id],
    ),
  ).toBe(1);
}

/** Add with a role answers the joined DTO; remove answers nothing and the row is gone. */
export async function assertAddsThenRemovesAMember(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const added = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id, role: ctx.roleCode });
  ctx.createdMembershipIds.push(added.membershipId);
  expect(added.assetId).toBe(asset.id);
  expect(added.role).toBe(ctx.roleCode);

  await expect(ctx.svc.removeMember(jwt, added.membershipId)).resolves.toBeUndefined();
  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_group_members WHERE id = $1", [added.membershipId]),
  ).toBe(0);
}

/** Positive control for every refusal below: the same caller, on its own site, is allowed. */
async function expectOwnSiteAllowed(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const group = await createGroup(ctx, jwt, ctx.scopedLocationId);
  expect(group.locationId).toBe(ctx.scopedLocationId);
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const member = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id });
  ctx.createdMembershipIds.push(member.membershipId);
  await ctx.svc.update(jwt, ctx.groupId, { description: "F3.78 pr4 own site" });
  await ctx.svc.removeMember(jwt, member.membershipId);
}

export async function assertCreateAtAnotherSiteIsRefused(ctx: GroupFixtures, scopedJwt: JwtPayload): Promise<void> {
  await expectOwnSiteAllowed(ctx, scopedJwt);
  const code = uniqueCode();
  const err = await rejection(() =>
    ctx.svc.create(scopedJwt, { locationId: ctx.foreignLocationId, code, name: "X" }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  expectNamesNone(err, [ctx.foreignLocationId, ctx.foreignOrganizationId]);
  expect(await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE code = $1", [code])).toBe(0);
}

export async function assertUpdateOfAnotherSitesGroupIsRefused(ctx: GroupFixtures, scopedJwt: JwtPayload): Promise<void> {
  await expectOwnSiteAllowed(ctx, scopedJwt);
  const err = await rejection(() => ctx.svc.update(scopedJwt, ctx.foreignGroupId, { name: "Hijacked" }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expectNamesNone(err, [ctx.foreignGroupId, ctx.foreignLocationId]);
  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE id = $1 AND name = 'Hijacked'", [
      ctx.foreignGroupId,
    ]),
  ).toBe(0);
}

export async function assertAddMemberToAnotherSitesGroupIsRefused(ctx: GroupFixtures, scopedJwt: JwtPayload): Promise<void> {
  await expectOwnSiteAllowed(ctx, scopedJwt);
  const asset = ctx.foreignAsset;
  const err = await rejection(() => ctx.svc.addMember(scopedJwt, ctx.foreignGroupId, { assetId: asset.id }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expectNamesNone(err, [ctx.foreignGroupId, asset.id, asset.code]);
  expect(
    await count(
      ctx,
      "SELECT count(*) AS n FROM bms.asset_group_members WHERE asset_group_id = $1 AND asset_id = $2",
      [ctx.foreignGroupId, asset.id],
    ),
  ).toBe(1); // the fixture's own membership, and no second row
}

export async function assertRemoveOfAnotherSitesMemberIsRefused(ctx: GroupFixtures, scopedJwt: JwtPayload): Promise<void> {
  await expectOwnSiteAllowed(ctx, scopedJwt);
  const err = await rejection(() => ctx.svc.removeMember(scopedJwt, ctx.foreignMembershipId));
  expect(err).toBeInstanceOf(ForbiddenException);
  expectNamesNone(err, [ctx.foreignMembershipId, ctx.foreignGroupId]);
  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_group_members WHERE id = $1", [ctx.foreignMembershipId]),
  ).toBe(1);
}

/** The audit row is part of the write's own transaction: when the write rolls back, so does it. */
export async function assertAuditRollsBackWithTheWrite(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  await expect(ctx.rollbackSvc.addMember(jwt, ctx.groupId, { assetId: asset.id })).rejects.toThrow(AUDIT_SENTINEL);

  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_group_members WHERE asset_id = $1", [asset.id]),
  ).toBe(0);
  expect(
    await count(
      ctx,
      "SELECT count(*) AS n FROM bms.audit_log WHERE action = 'master.asset_group_member.add' AND payload->>'assetId' = $1",
      [asset.id],
    ),
  ).toBe(0);
}

/** Create: the group row and its audit row both roll back, so neither is counted. */
export async function assertCreateAuditRollsBackWithTheWrite(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const code = uniqueCode();
  await expect(
    ctx.rollbackSvc.create(jwt, { locationId: ctx.scopedLocationId, code, name: "F3.78 pr4 rollback" }),
  ).rejects.toThrow(AUDIT_SENTINEL);

  expect(await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE code = $1", [code])).toBe(0);
  expect(
    await count(
      ctx,
      "SELECT count(*) AS n FROM bms.audit_log WHERE action = 'master.asset_group.create' AND payload->>'code' = $1",
      [code],
    ),
  ).toBe(0);
}

/** Update: the name is unchanged and no update audit row is left for the group. */
export async function assertUpdateAuditRollsBackWithTheWrite(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const group = await createGroup(ctx, jwt, ctx.scopedLocationId);
  await expect(ctx.rollbackSvc.update(jwt, group.id, { name: "F3.78 pr4 never saved" })).rejects.toThrow(
    AUDIT_SENTINEL,
  );

  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_groups WHERE id = $1 AND name = $2", [
      group.id,
      "F3.78 pr4 group",
    ]),
  ).toBe(1);
  expect((await auditRows(ctx, "master.asset_group.update", group.id)).length).toBe(0);
}

/** Remove: the membership is still there and no remove audit row is left for it. */
export async function assertRemoveMemberAuditRollsBackWithTheWrite(
  ctx: GroupFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const member = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id });
  ctx.createdMembershipIds.push(member.membershipId);
  await expect(ctx.rollbackSvc.removeMember(jwt, member.membershipId)).rejects.toThrow(AUDIT_SENTINEL);

  expect(
    await count(ctx, "SELECT count(*) AS n FROM bms.asset_group_members WHERE id = $1", [member.membershipId]),
  ).toBe(1);
  expect((await auditRows(ctx, "master.asset_group_member.remove", member.membershipId)).length).toBe(0);
}

export async function assertCreateWritesAnAuditRow(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const group = await createGroup(ctx, jwt, ctx.scopedLocationId);
  const rows = await auditRows(ctx, "master.asset_group.create", group.id);
  expect(rows.length).toBe(1);
  expect(rows[0]?.organization_id).toBe(ctx.scopedOrganizationId);
  expect(rows[0]?.actor_id).toBeTruthy();
}

export async function assertUpdateAuditNamesTheChangedFields(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const group = await createGroup(ctx, jwt, ctx.scopedLocationId);
  await ctx.svc.update(jwt, group.id, { name: "F3.78 pr4 renamed", description: null });
  const rows = await auditRows(ctx, "master.asset_group.update", group.id);
  expect(rows.length).toBe(1);
  expect(rows[0]?.payload?.fields).toEqual(["name", "description"]);
}

export async function assertAddMemberWritesAnAuditRow(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const member = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id });
  ctx.createdMembershipIds.push(member.membershipId);
  const rows = await auditRows(ctx, "master.asset_group_member.add", member.membershipId);
  expect(rows.length).toBe(1);
  expect(rows[0]?.organization_id).toBe(ctx.scopedOrganizationId);
  expect(rows[0]?.actor_id).toBeTruthy();
}

export async function assertRemoveMemberWritesAnAuditRow(ctx: GroupFixtures, jwt: JwtPayload): Promise<void> {
  const asset = await ctx.makeAsset(ctx.scopedLocationId, ctx.scopedOrganizationId, true);
  const member = await ctx.svc.addMember(jwt, ctx.groupId, { assetId: asset.id });
  ctx.createdMembershipIds.push(member.membershipId);
  await ctx.svc.removeMember(jwt, member.membershipId);
  const rows = await auditRows(ctx, "master.asset_group_member.remove", member.membershipId);
  expect(rows.length).toBe(1);
  expect(rows[0]?.payload?.assetId).toBe(asset.id);
}
