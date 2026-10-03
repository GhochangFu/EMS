import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetGroupsAdminService } from "./asset-groups.service";
import {
  assertAddMemberToAnotherSitesGroupIsRefused,
  assertAddMemberWritesAnAuditRow,
  assertAddsThenRemovesAMember,
  assertAuditRollsBackWithTheWrite,
  assertClearsRoleWithNull,
  assertCreateAtAnotherSiteIsRefused,
  assertCreateRejectsAnUnknownDomain,
  assertCreateWritesAnAuditRow,
  assertDuplicateGroupCodeIs409,
  assertDuplicateMemberIs409,
  assertInactiveAssetIs400,
  assertListReturnsOnlyWritableGroups,
  assertMembersOrderedByAssetCode,
  assertMemberFromOtherLocationIs400,
  assertMemberFromOtherOrganizationIs400,
  assertRefusesOutOfScopeMembership,
  assertRejectsRetiredRole,
  assertRemoveMemberWritesAnAuditRow,
  assertRemoveOfAnotherSitesMemberIsRefused,
  assertUpdateAuditNamesTheChangedFields,
  assertUpdateOfAnotherSitesGroupIsRefused,
  RollbackAuditService,
  assertRejectsUnknownRoleWith400,
  assertRoleCountsReportPluralRoles,
  assertSetsRoleOnMembership,
  assertWritesAuditRow,
} from "./asset-groups.service.integration.spec";
import type { FixtureAsset, GroupFixtures } from "./asset-groups.service.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F3.37` (ADR 0049 decision 5) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle and the
 * fixtures, following `assets.service.rls.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F3.37",
  label: "AssetGroupsAdminService against real, non-owner roles",
  because:
    "this is the only proof that the membership role write runs inside withTenant " +
    "against bms.asset_group_members' FORCE policy, that an unknown role is a 400 " +
    "naming live codes rather than the foreign key's 500, that members come back " +
    "ordered by assets.code, and that an out-of-scope membership is refused. None " +
    "of it can be shown on the fixture connection, which bypasses RLS regardless. " +
    "Fix the pipeline, do not relax this guard.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const LOCATION_ADMIN_EMAIL = "wc-admin@bms.local";

describe.skipIf(!connectionString)("F3.37 — AssetGroupsAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: GroupFixtures;

  let adminJwt: JwtPayload;
  let scopedJwt: JwtPayload;

  const createdAssetIds: string[] = [];
  /** F3.78 - locations this suite inserts so one asset can sit at a second site of the same organization. */
  const createdLocationIds: string[] = [];
  const createdGroupIds: string[] = [];
  /**
   * Every membership this suite creates, so `afterAll` can delete **its own**
   * audit rows and only those. The first version deleted by `entity_type`
   * alone, on a `BYPASSRLS` connection: `pnpm test` then erased every real
   * `master.asset_group_member.role.set` record in every organization. CI never
   * saw it — its database is created per run — which is §4.6's asymmetry
   * running in the destructive direction.
   */
  const createdMembershipIds: string[] = [];
  /** Role codes an assertion INSERTs — see `GroupFixtures.createdRoleCodes`. */
  const createdRoleCodes: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // Five connections, not the default sixteen, and this is measured rather
    // than cautious. Four pools at the default max of 4 is 16 connections, and the api project already
    // ran one suite short of Postgres' 100 before this file existed: adding
    // this suite at the default turned that into SIX suites failing at setup
    // with "Connection terminated due to connection timeout", none of them
    // this one. Two is enough because every assertion here runs sequentially;
    // the only concurrency is `VocabulariesService.list`'s five-query
    // Promise.all, which queues rather than needing a client each.
    //
    // The headroom is genuinely tight for the whole project, not just here.
    // That is a finding for whoever adds the next integration suite, not
    // something this row could fix.
    const one = { max: 1 };
    // `ownerPool` is the FIXTURE connection, and it is NOT `bms_owner`:
    // `requireIntegrationDb` defaults `connection` to "fleet", so this is
    // `bms_fleet` (BYPASSRLS). The name is kept because the rename is churn,
    // but do not "correct" it to `connection: "owner"` — `roles.ts` sets
    // `ALTER ROLE bms_owner NOBYPASSRLS`, so the fixture INSERTs below would
    // become FORCE-bound with no GUC and the whole suite would fail to set up.
    ownerPool = await openIntegrationPool(url, "F3.37", one);
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.37",
      one,
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.37",
      one,
    );
    // The one pool that gets two. `VocabulariesService.list` fires five queries
    // in a Promise.all on this pool, and `MasterDataAuditService` reads the
    // actor here while a tenant transaction is open elsewhere. One client would
    // still work — pg queues acquisitions — but two keeps the queue off the
    // 5s acquisition timeout with no measurable cost.
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.37",
      { max: 2 },
    );
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    adminJwt = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");
    scopedJwt = jwtFor(LOCATION_ADMIN_EMAIL, "location_admin");

    // The location-scoped seed user's own location, and one in another
    // organization, so the refusal has something real to refuse.
    const scopedLoc = await ownerPool.query<{ id: string; organization_id: string }>(
      `SELECT l.id, l.organization_id
         FROM bms.locations l
         JOIN bms.user_location_access ula ON ula.location_id = l.id
         JOIN bms.users u ON u.id = ula.user_id
        WHERE u.email = $1 AND l.active = true
        -- F4.53: created_at first, so this resolves a SEEDED location. A
        -- seeded row predates every suite in the run, so it is the only one no
        -- concurrent suite can delete out from under this one. The code column
        -- is the tiebreaker, never the sort key.
        ORDER BY l.created_at, l.code LIMIT 1`,
      [LOCATION_ADMIN_EMAIL],
    );
    if (!scopedLoc.rows[0]) {
      throw new Error(`F3.37: ${LOCATION_ADMIN_EMAIL} has no location grant — run pnpm db:seed.`);
    }
    const { id: locationId, organization_id: organizationId } = scopedLoc.rows[0];

    const foreignLoc = await ownerPool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations
        WHERE organization_id <> $1 AND active = true
        ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!foreignLoc.rows[0]) {
      throw new Error("F3.37: need a location in another organization to prove the scope refusal.");
    }

    const domain = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY sort_order LIMIT 1",
    );
    if (!domain.rows[0]) {
      throw new Error("F3.37: no active asset_domain — run pnpm db:seed.");
    }

    const roles = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_roles WHERE active = true ORDER BY sort_order LIMIT 2",
    );
    if (roles.rows.length < 2) {
      // 28 = `0051`'s 26 plus `0060`'s `meter` and `pump` (`F3.40`). The
      // fixture needs only two, and takes the two lowest `sort_order` — `0060`
      // appends at 170/180, below no band boundary and above every code this
      // picks, so the growth does not move what this reads.
      throw new Error("F3.37: migrations 0051 and 0060 seed 28 roles — run pnpm db:migrate.");
    }

    const stamp = Date.now();

    async function makeGroup(locId: string, orgId: string, suffix: string): Promise<string> {
      const { rows } = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, locId, `f337-${suffix}-${stamp}`, `F3.37 fixture ${suffix}`],
      );
      const id = rows[0]?.id as string;
      createdGroupIds.push(id);
      return id;
    }

    async function makeMember(
      groupId: string,
      locId: string,
      orgId: string,
      code: string,
    ): Promise<string> {
      const asset = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, code, `F3.37 ${code}`, "F3.37 fixture site", locId, domain.rows[0]?.code],
      );
      const assetId = asset.rows[0]?.id as string;
      createdAssetIds.push(assetId);
      const member = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_group_members (asset_group_id, asset_id)
         VALUES ($1, $2) RETURNING id`,
        [groupId, assetId],
      );
      const membershipId = member.rows[0]?.id as string;
      createdMembershipIds.push(membershipId);
      return membershipId;
    }

    const groupId = await makeGroup(locationId, organizationId, "main");
    const foreignGroupId = await makeGroup(
      foreignLoc.rows[0].id,
      foreignLoc.rows[0].organization_id,
      "foreign",
    );

    // INSERTed c, a, b — deliberately not code order, so `assertMembersOrdered
    // ByAssetCode` fails against a service that returns rows unordered rather
    // than passing by luck.
    const membershipIds = [
      await makeMember(groupId, locationId, organizationId, `f337-c-${stamp}`),
      await makeMember(groupId, locationId, organizationId, `f337-a-${stamp}`),
      await makeMember(groupId, locationId, organizationId, `f337-b-${stamp}`),
    ];
    const foreignMembershipId = await makeMember(
      foreignGroupId,
      foreignLoc.rows[0].id,
      foreignLoc.rows[0].organization_id,
      `f337-foreign-${stamp}`,
    );

    // F3.78 - a second location of the scoped organization, and fresh assets, all suite-owned.
    const locationType = await ownerPool.query<{ type: string }>(
      "SELECT type FROM bms.locations WHERE id = $1",
      [locationId],
    );
    const otherSlug = `f378-pr4-${randomUUID()}`;
    const otherLoc = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $2, $3, $4, 0, 0) RETURNING id`,
      [organizationId, otherSlug, "F3.78 pr4 second site", locationType.rows[0]?.type],
    );
    const otherLocationId = otherLoc.rows[0]?.id as string;
    createdLocationIds.push(otherLocationId);

    async function makeAsset(locId: string, orgId: string, active: boolean): Promise<FixtureAsset> {
      const code = `f378-pr4-${randomUUID()}`;
      const name = `F3.78 pr4 ${code}`;
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [orgId, code, name, "F3.78 fixture site", locId, domain.rows[0]?.code, active],
      );
      const id = row.rows[0]?.id as string;
      createdAssetIds.push(id);
      return { id, code, name };
    }
    const otherLocationAsset = await makeAsset(otherLocationId, organizationId, true);
    const foreignAssetRow = await ownerPool.query<FixtureAsset>(
      `SELECT a.id, a.code, a.name FROM bms.asset_group_members m
         JOIN bms.assets a ON a.id = m.asset_id WHERE m.id = $1`,
      [foreignMembershipId],
    );
    const accessControl = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const vocabularies = new VocabulariesService(createDb(fleetPool));

    ctx = {
      scopedLocationId: locationId,
      scopedOrganizationId: organizationId,
      foreignLocationId: foreignLoc.rows[0].id,
      foreignOrganizationId: foreignLoc.rows[0].organization_id,
      foreignAsset: foreignAssetRow.rows[0] as FixtureAsset,
      otherLocationAsset,
      makeAsset,
      createdGroupIds,
      createdMembershipIds,
      rollbackSvc: new AssetGroupsAdminService(
        createDb(fleetPool),
        createDb(tenantPool),
        accessControl,
        // The default executor is the fleet pool: see RollbackAuditService.
        new RollbackAuditService(createDb(fleetPool), createDb(fleetPool)),
        vocabularies,
      ),
      svc: new AssetGroupsAdminService(
        createDb(fleetPool),
        createDb(tenantPool),
        new AccessControlService(createDb(authPool), createDb(fleetPool)),
        new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
        new VocabulariesService(createDb(fleetPool)),
      ),
      ownerPool,
      groupId,
      foreignGroupId,
      membershipIds,
      foreignMembershipId,
      roleCode: roles.rows[0]?.code as string,
      secondRoleCode: roles.rows[1]?.code as string,
      createdRoleCodes,
    };
  });

  afterAll(async () => {
    if (createdGroupIds.length > 0) {
      // Memberships first: `asset_group_members` references both parents with
      // no ON DELETE, by design, so the parents cannot go first.
      await ownerPool.query(
        "DELETE FROM bms.asset_group_members WHERE asset_group_id = ANY($1)",
        [createdGroupIds],
      );
      // **A cross-suite coupling, and CI is the only place it fires.**
      //
      // `dashboards.service.rls.integration.test.ts` (`F3.1b`) resolves its
      // asset group with
      //   SELECT id FROM bms.asset_groups WHERE organization_id = $1
      //   ORDER BY created_at, id LIMIT 1
      // and its own comment records that **PHEWB has no seeded asset groups on
      // a clean database** — only a developer database accumulates them. This
      // suite's `foreign` fixture is created in another organization, which on
      // CI is PHEWB, so it becomes the only and therefore oldest group there.
      // `F3.1b` adopts it instead of creating its own and attaches a dashboard,
      // and the DELETE below then fails on `dashboards_asset_group_id_fkey`.
      // Measured: green locally, red on CI, where the database is clean.
      //
      // Scoped to dashboards pointing at THIS suite's own group ids — never a
      // sweep. Such a row can only be a transient fixture attached to a group
      // that is being torn down, so it is unusable either way; leaving it would
      // leak both the dashboard and the group permanently. Widgets cascade
      // (ADR 0047 Amendment 1), so this needs no second statement.
      //
      // The durable fix belongs to `F3.1b`: a suite that adopts an arbitrary
      // pre-existing row cannot tell a seeded one from another suite's fixture.
      // Raised rather than reached into from here.
      await ownerPool.query("DELETE FROM bms.dashboards WHERE asset_group_id = ANY($1)", [
        createdGroupIds,
      ]);
      await ownerPool.query("DELETE FROM bms.asset_groups WHERE id = ANY($1)", [createdGroupIds]);
    }
    if (createdGroupIds.length > 0) {
      await ownerPool.query(
        "DELETE FROM bms.audit_log WHERE entity_type = 'asset_group' AND entity_id = ANY($1)",
        [createdGroupIds],
      );
    }
    if (createdMembershipIds.length > 0) {
      // Scoped to this suite's own memberships. `entity_type` alone would
      // erase every organization's real role-change history on a developer
      // database — see `createdMembershipIds`.
      await ownerPool.query(
        "DELETE FROM bms.audit_log WHERE entity_type = 'asset_group_member' AND entity_id = ANY($1)",
        [createdMembershipIds],
      );
    }
    // Exact codes, never `LIKE 'f337-%'`. bms.asset_roles is global, so a
    // leaked fixture is visible to every organization — but a prefix sweep is
    // worse: `tests/integration-fixture-isolation.test.ts` fails it because two
    // parallel instances of this file would delete each other's rows.
    if (createdRoleCodes.length > 0) {
      await ownerPool.query("DELETE FROM bms.asset_roles WHERE code = ANY($1)", [createdRoleCodes]);
    }
    if (createdAssetIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    if (createdLocationIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.locations WHERE id = ANY($1)", [createdLocationIds]);
    }
    // Leak check: every row this suite registered is gone. A row created before
    // its id was registered would not be caught here, which is why each case
    // registers the id the line after the service returns it.
    const leaked = await ownerPool.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM bms.asset_groups WHERE id = ANY($1))
            + (SELECT count(*) FROM bms.assets WHERE id = ANY($2))
            + (SELECT count(*) FROM bms.locations WHERE id = ANY($3)) AS n`,
      [createdGroupIds, createdAssetIds, createdLocationIds],
    );
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
    if (Number(leaked.rows[0]?.n) !== 0) {
      throw new Error(`F3.78 pr4: ${leaked.rows[0]?.n} fixture rows leaked`);
    }
  });

  it("lists only groups the caller may administer, with a member count", async () => {
    await assertListReturnsOnlyWritableGroups(ctx, scopedJwt);
  });

  it("returns members ordered by assets.code, not by insertion order", async () => {
    await assertMembersOrderedByAssetCode(ctx, adminJwt);
  });

  it("counts how many members carry each role", async () => {
    await assertRoleCountsReportPluralRoles(ctx, adminJwt);
  });

  it("sets a role on a membership and joins its label", async () => {
    await assertSetsRoleOnMembership(ctx, adminJwt);
  });

  it("clears a role with an explicit null", async () => {
    await assertClearsRoleWithNull(ctx, adminJwt);
  });

  it("rejects an unknown role with a 400 naming live codes, not the foreign key's 500", async () => {
    await assertRejectsUnknownRoleWith400(ctx, adminJwt);
  });

  it("rejects a retired role", async () => {
    await assertRejectsRetiredRole(ctx, adminJwt);
  });

  it("refuses a membership outside the caller's scope, on both read and write", async () => {
    await assertRefusesOutOfScopeMembership(ctx, scopedJwt);
  });

  it("writes one audit row with a real organization and a resolved actor", async () => {
    await assertWritesAuditRow(ctx, adminJwt);
  });

  it("a duplicate group code at a location is a 409 and writes no second row", async () => {
    await assertDuplicateGroupCodeIs409(ctx, adminJwt);
  });

  it("create rejects an unknown domain with a 400", async () => {
    await assertCreateRejectsAnUnknownDomain(ctx, adminJwt);
  });

  it("a member from another location is a 400 that names no asset", async () => {
    await assertMemberFromOtherLocationIs400(ctx, adminJwt);
  });

  it("a member from another organization is a 400 that names no asset", async () => {
    await assertMemberFromOtherOrganizationIs400(ctx, adminJwt);
  });

  it("an inactive asset is a 400", async () => {
    await assertInactiveAssetIs400(ctx, adminJwt);
  });

  it("a duplicate member is a 409 and leaves one row", async () => {
    await assertDuplicateMemberIs409(ctx, adminJwt);
  });

  it("adds a member with a role, then removes it", async () => {
    await assertAddsThenRemovesAMember(ctx, adminJwt);
  });

  it("create at another site's location is refused for a location_admin and writes nothing", async () => {
    await assertCreateAtAnotherSiteIsRefused(ctx, scopedJwt);
  });

  it("update of another site's group is refused for a location_admin and writes nothing", async () => {
    await assertUpdateOfAnotherSitesGroupIsRefused(ctx, scopedJwt);
  });

  it("addMember to another site's group is refused for a location_admin and writes nothing", async () => {
    await assertAddMemberToAnotherSitesGroupIsRefused(ctx, scopedJwt);
  });

  it("removeMember of another site's membership is refused for a location_admin and deletes nothing", async () => {
    await assertRemoveOfAnotherSitesMemberIsRefused(ctx, scopedJwt);
  });

  it("the audit row rolls back with the write it describes", async () => {
    await assertAuditRollsBackWithTheWrite(ctx, adminJwt);
  });

  it("create writes one audit row with a real organization and actor", async () => {
    await assertCreateWritesAnAuditRow(ctx, adminJwt);
  });

  it("update's audit row names the changed fields", async () => {
    await assertUpdateAuditNamesTheChangedFields(ctx, adminJwt);
  });

  it("addMember writes one audit row", async () => {
    await assertAddMemberWritesAnAuditRow(ctx, adminJwt);
  });

  it("removeMember writes one audit row naming the asset", async () => {
    await assertRemoveMemberWritesAnAuditRow(ctx, adminJwt);
  });
});
