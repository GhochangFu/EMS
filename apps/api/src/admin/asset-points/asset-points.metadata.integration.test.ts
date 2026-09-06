import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assetPoints, assetTemplates, assets, createDb, pointKeys, templatePoints } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAComputedRowRefusesMetadataAndWiring,
  assertAZeroMultiplierIsRefusedByTheBodyNotTheDatabase,
  assertCreateRefusesATemplateDerivedKey,
  assertCreateWiresAnRtuOfTheAssetsOwnLocation,
  assertCreateWritesTheFiveMetadataColumns,
  assertRtuIdWiresAndUnwiresOnUpdate,
  assertTheMergedPairRefusalNamesTheInheritedBound,
  type MetadataFixtures,
} from "./asset-points.metadata.integration.spec";
import { AssetPointsAdminService } from "./asset-points.service";

/**
 * `F2.7` Unit C — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle and the fixtures, the same
 * four-role shape as `asset-points.service.rls.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F2.7",
  label: "asset-point metadata, the merged-pair check and the Q-H rtuId ruling",
  because:
    "every rule under test spans two rows: the merged-pair refusal reads the template's " +
    "eng_max for the same point key, the RTU assertion reads rtus.location_id against the " +
    "asset's location, and asset_points_source_ref_check is what makes unwiring a measured " +
    "point mean 'become unmapped'. Without a database this suite would assert the service's " +
    "arithmetic and none of the behaviour the routes actually have.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000005";

// Per-run fixture prefixes (`F4.65`). `afterAll` sweeps with `DELETE ... WHERE
// code LIKE` on the fleet (BYPASSRLS) pool, which sees every organization's
// rows, so a family-wide prefix would reap a concurrent instance's committed
// fixtures. Each prefix carries its own `randomUUID()` in its own declaration,
// because `tests/integration-fixture-isolation.test.ts` reads that declaration
// literally to decide the sweep is run-unique.
const ASSET_PREFIX = `F27-AP-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const POINT_KEY_PREFIX = `F27_AP_${randomUUID().replace(/-/g, "").slice(0, 12)}_`;

const TEMPLATE_CODE = `${ASSET_PREFIX}TPL`;
const HAND_ASSET_CODE = `${ASSET_PREFIX}HAND`;
const TEMPLATED_ASSET_CODE = `${ASSET_PREFIX}TPLD`;

/**
 * Eight catalog point keys, one per case, so no case can be made to pass by
 * another's row. All eight carry the per-run token, so none is a row a
 * concurrent instance of this file also wants — unlike a fixed code, which
 * would need `registerFixturePointKeys` and its symmetric removal.
 */
const KEYS = {
  withMetadata: `${POINT_KEY_PREFIX}META`,
  wired: `${POINT_KEY_PREFIX}WIRED`,
  foreignRtu: `${POINT_KEY_PREFIX}FOREIGN`,
  measured: `${POINT_KEY_PREFIX}MEAS`,
  computed: `${POINT_KEY_PREFIX}COMP`,
  derivedDeclared: `${POINT_KEY_PREFIX}DER`,
  unmapped: `${POINT_KEY_PREFIX}UNMAP`,
  manual: `${POINT_KEY_PREFIX}MANUAL`,
} as const;

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F2.7 — asset-point metadata and RTU wiring", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: MetadataFixtures;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F2.7");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.7",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.7",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.7",
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
        `F2.7: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    // Two locations of the one organization: the asset's own, and the one whose
    // RTU must be refused. `ORDER BY created_at, code` resolves the oldest rows
    // — seeded ones, which no suite deletes (`F4.53`).
    const locs = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true
         ORDER BY created_at, code LIMIT 2`,
      [organizationId],
    );
    if (locs.rows.length < 2) {
      throw new Error(
        "F2.7: this organization needs two active locations — the wiring cases turn on an " +
          "RTU that is in the same organization and NOT in the asset's location. Run pnpm db:seed.",
      );
    }
    const [locationId, otherLocationId] = [locs.rows[0].id, locs.rows[1].id];

    const rtuHere = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.rtus WHERE location_id = $1 AND active = true
        ORDER BY created_at, code LIMIT 1`,
      [locationId],
    );
    const rtuThere = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.rtus WHERE location_id = $1 AND active = true
        ORDER BY created_at, code LIMIT 1`,
      [otherLocationId],
    );
    if (!rtuHere.rows[0] || !rtuThere.rows[0]) {
      throw new Error("F2.7: both locations need an active RTU — run pnpm db:seed.");
    }

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F2.7: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    let handAssetId = "";
    let templatedAssetId = "";
    let computedPointId = "";
    let unmappedPointId = "";
    let manualPointId = "";

    // One tenant GUC for every parent: `point_keys`, `asset_templates`,
    // `assets` and `asset_points` are policied with FORCE, and the GUC is what
    // their WITH CHECK reads.
    await withTenant(tenantDb, organizationId, async (tx) => {
      await tx.insert(pointKeys).values(
        Object.values(KEYS).map((code) => ({
          code,
          name: `F2.7 ${code}`,
          unit: "kW",
          active: true,
        })),
      );

      const [tpl] = await tx
        .insert(assetTemplates)
        .values({
          organizationId,
          code: TEMPLATE_CODE,
          version: 1,
          name: "F2.7 metadata template",
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
          pointKey: KEYS.measured,
          kind: "measured",
          sourceDataKeyPattern: "SITE/{asset_code}/M",
          sortOrder: 0,
          // The class default the merged-pair refusal must name. Nothing in the
          // request under test carries `100`.
          engMax: 100,
        },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.computed,
          kind: "derived",
          sortOrder: 1,
          formula: `{${KEYS.measured}} * 2`,
          formulaDialect: "bms-calc-v1",
          calcTrigger: "streaming",
        },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.derivedDeclared,
          kind: "derived",
          sortOrder: 2,
          formula: `{${KEYS.measured}} * 3`,
          formulaDialect: "bms-calc-v1",
          calcTrigger: "streaming",
        },
      ]);

      const [handAsset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: HAND_ASSET_CODE,
          name: "F2.7 hand-created asset",
          siteName: "F2.7 Site",
          locationId,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      handAssetId = handAsset.id;

      const [templatedAsset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: TEMPLATED_ASSET_CODE,
          name: "F2.7 templated asset",
          siteName: "F2.7 Site",
          locationId,
          domain,
          templateId: tpl.id,
          active: true,
        })
        .returning({ id: assets.id });
      templatedAssetId = templatedAsset.id;

      // Three rows no API route can create: the calc-override surface's
      // `computed` row, an `unmapped` row to wire, and a `manual` one that
      // unwiring must leave alone. `asset_points_source_ref_check` requires a
      // null `rtu_id` on all three.
      const [computed, unmapped, manual] = await tx
        .insert(assetPoints)
        .values([
          {
            assetId: templatedAssetId,
            organizationId,
            pointKey: KEYS.computed,
            sourceDataKey: `computed:${KEYS.computed}`,
            sourceKind: "computed",
            active: true,
          },
          {
            assetId: templatedAssetId,
            organizationId,
            pointKey: KEYS.unmapped,
            sourceDataKey: `${KEYS.unmapped}/RAW`,
            sourceKind: "unmapped",
            active: true,
          },
          {
            assetId: templatedAssetId,
            organizationId,
            pointKey: KEYS.manual,
            sourceDataKey: `${KEYS.manual}/RAW`,
            sourceKind: "manual",
            active: true,
          },
        ])
        .returning({ id: assetPoints.id });
      computedPointId = computed.id;
      unmappedPointId = unmapped.id;
      manualPointId = manual.id;
    });

    ctx = {
      svc: new AssetPointsAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      fleetPool,
      handAssetId,
      templatedAssetId,
      rtuInLocation: rtuHere.rows[0].id,
      rtuElsewhere: rtuThere.rows[0].id,
      keys: KEYS,
      computedPointId,
      unmappedPointId,
      manualPointId,
    };
  });

  afterAll(async () => {
    // Children first, on the BYPASSRLS fleet connection, and the whole sweep in
    // a `try` so a single throw cannot leak four pools (the `E7.1b` bracket).
    // `audit_log` has no foreign key on `entity_id`, so it is joined back to
    // this suite's own assets before they go.
    try {
      if (ownerPool) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_id IN
             (SELECT ap.id FROM bms.asset_points ap
                JOIN bms.assets a ON a.id = ap.asset_id
               WHERE a.code LIKE $1)`,
          [`${ASSET_PREFIX}%`],
        );
        await ownerPool.query(
          `DELETE FROM bms.asset_group_members
            WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
          [`${ASSET_PREFIX}%`],
        );
        await ownerPool.query(
          `DELETE FROM bms.asset_points
            WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
          [`${ASSET_PREFIX}%`],
        );
        await ownerPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${ASSET_PREFIX}%`]);
        // `template_points` cascade on the FK when the template goes, and they
        // reference the catalog codes swept last.
        await ownerPool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [
          `${ASSET_PREFIX}%`,
        ]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [
          `${POINT_KEY_PREFIX}%`,
        ]);
      }
    } finally {
      await Promise.all(
        [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
      );
    }
  });

  it("(a) writes all five metadata columns on create", async () => {
    await assertCreateWritesTheFiveMetadataColumns(ctx, jwt);
  });

  it("(b) wires an RTU of the asset's own location and refuses one from elsewhere", async () => {
    await assertCreateWiresAnRtuOfTheAssetsOwnLocation(ctx, jwt);
  });

  it("(c) refuses the merged pair, naming the bound inherited from the template", async () => {
    await assertTheMergedPairRefusalNamesTheInheritedBound(ctx, jwt);
  });

  it("(d) refuses metadata and wiring on a computed row", async () => {
    await assertAComputedRowRefusesMetadataAndWiring(ctx, jwt);
  });

  it("refuses a create on a point key the template declares derived", async () => {
    await assertCreateRefusesATemplateDerivedKey(ctx, jwt);
  });

  it("(e) refuses a zero multiplier in the body, so the CHECK is unreachable", () => {
    assertAZeroMultiplierIsRefusedByTheBodyNotTheDatabase();
  });

  it("(f) Q-H — rtuId wires, null unwires, and a manual row stays manual", async () => {
    await assertRtuIdWiresAndUnwiresOnUpdate(ctx, jwt);
  });
});
