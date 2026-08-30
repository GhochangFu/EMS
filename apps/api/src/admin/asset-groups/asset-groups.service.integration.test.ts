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
  assertClearsRoleWithNull,
  assertListReturnsOnlyWritableGroups,
  assertMembersOrderedByAssetCode,
  assertRefusesOutOfScopeMembership,
  assertRejectsRetiredRole,
  assertRejectsUnknownRoleWith400,
  assertRoleCountsReportPluralRoles,
  assertSetsRoleOnMembership,
  assertWritesAuditRow,
} from "./asset-groups.service.integration.spec";
import type { GroupFixtures } from "./asset-groups.service.integration.spec";

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
    "of it can be shown on the owner connection, which bypasses RLS regardless. " +
    "Fix the pipeline, do not relax this guard.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const LOCATION_ADMIN_EMAIL = "wc-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000037";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F3.37 — AssetGroupsAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: GroupFixtures;

  const adminJwt = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");
  const scopedJwt = jwtFor(LOCATION_ADMIN_EMAIL, "location_admin");

  const createdAssetIds: string[] = [];
  const createdGroupIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.37");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.37",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.37",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.37",
    );

    // The location-scoped seed user's own location, and one in another
    // organization, so the refusal has something real to refuse.
    const scopedLoc = await ownerPool.query<{ id: string; organization_id: string }>(
      `SELECT l.id, l.organization_id
         FROM bms.locations l
         JOIN bms.user_location_access ula ON ula.location_id = l.id
         JOIN bms.users u ON u.id = ula.user_id
        WHERE u.email = $1 AND l.active = true
        ORDER BY l.code LIMIT 1`,
      [LOCATION_ADMIN_EMAIL],
    );
    if (!scopedLoc.rows[0]) {
      throw new Error(`F3.37: ${LOCATION_ADMIN_EMAIL} has no location grant — run pnpm db:seed.`);
    }
    const { id: locationId, organization_id: organizationId } = scopedLoc.rows[0];

    const foreignLoc = await ownerPool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations
        WHERE organization_id <> $1 AND active = true ORDER BY code LIMIT 1`,
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
      throw new Error("F3.37: migration 0051 seeds 26 roles — run pnpm db:migrate.");
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
      return member.rows[0]?.id as string;
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

    ctx = {
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
      await ownerPool.query("DELETE FROM bms.asset_groups WHERE id = ANY($1)", [createdGroupIds]);
    }
    if (createdAssetIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_type = 'asset_group_member'");
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
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
});
