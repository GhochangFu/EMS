import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assetTemplates, assets, createDb, pointKeys, templatePoints } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import { AssetPointsAdminService } from "./asset-points.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertMappingCreateStampsOrgUnderRealRls,
  assertOverrideEagerCreateStampsOrgUnderRealRls,
  type RlsFixtures,
} from "./asset-points.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `assets.service.rls.integration.test.ts` against the two `asset_points` write
 * paths — the telemetry-mapping writer and the calc-override eager creator.
 *
 * Parent fixtures (a template, a templated asset, a hand asset, a catalog point
 * key) are inserted through `bms_tenant` inside one `withTenant` block: 0039:49
 * grants it INSERT on every `bms` table, and the GUC satisfies the policied
 * `asset_templates`/`point_keys` (`FORCE` since F4.16). Cleanup runs on
 * `ownerPool` — the `bms_fleet` BYPASSRLS connection the gate hands back.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "asset_points write funnels against real, non-owner roles",
  because:
    "AssetPointsAdminService and AssetPointCalcOverrideService write asset_points, and " +
    "neither had a real-roles test. Constructing them with real bms_auth/bms_tenant/bms_fleet " +
    "connections is the only proof that both derive organization_id from the asset and stamp it " +
    "under withTenant, rather than passing only because the owner connection bypasses row-level " +
    "security regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000005";

// Per-run fixture prefixes (F4.65). afterAll cleans up with `DELETE ... WHERE
// code LIKE`, and it runs on the fleet (BYPASSRLS) pool the gate hands back —
// which sees every organization's rows — so a family-wide sweep would reap a
// concurrent instance's committed fixtures, not just this run's. Each swept
// prefix carries a per-run `randomUUID()` in its own declaration, because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads that
// declaration literally to decide the sweep is run-unique.
const ASSET_PREFIX = `E71B-AP-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const CATALOG_CODE = `E71B_AP_${randomUUID().replace(/-/g, "").slice(0, 12)}_CAT`;
const TEMPLATE_CODE = `${ASSET_PREFIX}TPL`;
const HAND_ASSET_CODE = `${ASSET_PREFIX}MAP`;
const TEMPLATED_ASSET_CODE = `${ASSET_PREFIX}TAS`;
// template_points.point_key, not point_keys rows: no FK/CHECK, and they cascade
// with the template, so they need no per-run token or sweep of their own.
const MEASURED_KEY = "E71B_AP_M";
const DERIVED_KEY = "E71B_AP_D";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("E7.1b — asset_points write funnels under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: RlsFixtures;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }
    const locationId = loc.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    // Seed the parents inside one tenant GUC. `asset_templates` and `point_keys`
    // are policied (FORCE); the GUC = org makes their WITH CHECK pass. `assets`
    // and `template_points` are not policied until 0047 and ignore the GUC.
    let mappingAssetId = "";
    let templatedAssetId = "";
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [tpl] = await tx
        .insert(assetTemplates)
        .values({
          organizationId,
          code: TEMPLATE_CODE,
          version: 1,
          name: "E7.1b AP Template",
          assetType: "test_rig",
          domain,
          status: "published",
          publishedAt: new Date(),
        })
        .returning({ id: assetTemplates.id });

      await tx.insert(templatePoints).values([
        {
          templateId: tpl.id,
          organizationId,
          pointKey: MEASURED_KEY,
          kind: "measured",
          sourceDataKeyPattern: "SITE/{asset_code}/M",
          sortOrder: 0,
        },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: DERIVED_KEY,
          kind: "derived",
          sortOrder: 1,
          formula: `{${MEASURED_KEY}} * 2`,
          formulaDialect: "bms-calc-v1",
          calcTrigger: "scheduled",
          calcIntervalSeconds: 300,
          maxInputAgeSeconds: 600,
        },
      ]);

      const [handAsset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: HAND_ASSET_CODE,
          name: "E7.1b AP Mapping Asset",
          siteName: "E7.1b Site",
          locationId,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      mappingAssetId = handAsset.id;

      const [templatedAsset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: TEMPLATED_ASSET_CODE,
          name: "E7.1b AP Templated Asset",
          siteName: "E7.1b Site",
          locationId,
          domain,
          templateId: tpl.id,
          active: true,
        })
        .returning({ id: assets.id });
      templatedAssetId = templatedAsset.id;

      await tx.insert(pointKeys).values({
        organizationId,
        code: CATALOG_CODE,
        name: "E7.1b AP Catalog Key",
        unit: "kW",
        active: true,
      });
    });

    ctx = {
      pointsSvc: new AssetPointsAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      overrideSvc: new AssetPointCalcOverrideService(
        tenantDb,
        fleetDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      ownerPool,
      organizationId,
      mappingAssetId,
      catalogPointKey: CATALOG_CODE,
      templatedAssetId,
      derivedKey: DERIVED_KEY,
    };
  });

  afterAll(async () => {
    // children first, on the BYPASSRLS fleet connection. audit_log has no FK on
    // entity_id, so it is cleared first by joining back to this suite's assets.
    if (ownerPool) {
      await ownerPool.query(
        `DELETE FROM bms.audit_log WHERE entity_id IN
           (SELECT ap.id FROM bms.asset_points ap
              JOIN bms.assets a ON a.id = ap.asset_id
             WHERE a.code LIKE $1)`,
        [`${ASSET_PREFIX}%`],
      );
      await ownerPool.query(
        `DELETE FROM bms.asset_points
          WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${ASSET_PREFIX}%`],
      );
      await ownerPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${ASSET_PREFIX}%`]);
      // template_points cascade on the FK when the template goes.
      await ownerPool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [
        `${ASSET_PREFIX}%`,
      ]);
      await ownerPool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [`${CATALOG_CODE}%`]);
    }
    await Promise.all(
      [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
  });

  it("maps a catalog point key onto an asset, stamping org, and survives the lifecycle", async () => {
    await assertMappingCreateStampsOrgUnderRealRls(ctx, jwt);
  });

  it("stamps org on the asset_points row setOverride eagerly creates (decision 7)", async () => {
    await assertOverrideEagerCreateStampsOrgUnderRealRls(ctx, jwt);
  });
});
