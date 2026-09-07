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
  assertAComputedRowRefusesAMetadataPatch,
  assertACallerOutsideTheLocationIsRefused,
  assertAnInvertedMergedBandRefusesTheWholeSelection,
  assertAnUnknownIdIsNamedAndNothingIsWritten,
  assertASelectionSpanningTwoOrganizationsIsRefused,
  assertOnePatchLandsOnEverySelectedRow,
  assertTheStateFlipAloneIsAccepted,
  type BulkUpdateFixtures,
} from "./asset-points.bulk-update.integration.spec";
import { AssetPointsAdminService } from "./asset-points.service";

/**
 * `F2.7` Unit I — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle and the fixtures, the same
 * four-role shape as `asset-points.metadata.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F2.7",
  label: "the bulk editor: one patch over a selection, all or nothing",
  because:
    "all-or-nothing is a property of a transaction, not of a function: the only way to show " +
    "a refused selection wrote nothing is to read every row and every audit row back after " +
    "it. The merged-band refusal also reads the template point for the same key, and the " +
    "scope refusal is writableLocationIds against real grant rows. Without a database this " +
    "suite would assert the service's arithmetic and none of its behaviour.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const OTHER_LOCATION_ADMIN_EMAIL = "wc-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000009";

// Per-run fixture prefixes (`F4.65`). `afterAll` sweeps with `DELETE ... WHERE
// code LIKE` on the owner pool, which sees every organization's rows, so a
// family-wide prefix would reap a concurrent instance's committed fixtures.
// Each prefix carries its own `randomUUID()` in its own declaration, because
// `tests/integration-fixture-isolation.test.ts` reads that declaration
// literally to decide the sweep is run-unique.
const ASSET_PREFIX = `F27-BU-${randomUUID().replace(/-/g, "").slice(0, 8)}-`;
const POINT_KEY_PREFIX = `F27_BU_${randomUUID().replace(/-/g, "").slice(0, 8)}_`;

const TEMPLATE_CODE = `${ASSET_PREFIX}TPL`;
const ASSET_CODE = `${ASSET_PREFIX}A1`;

/**
 * Four catalog point keys — three measured targets and the derived one the
 * `computed` row hangs off. All four carry the per-run token, so none is a row
 * a concurrent instance of this file also wants.
 */
const KEYS = {
  plain: `${POINT_KEY_PREFIX}PLAIN`,
  banded: `${POINT_KEY_PREFIX}BANDED`,
  third: `${POINT_KEY_PREFIX}THIRD`,
  computed: `${POINT_KEY_PREFIX}COMP`,
} as const;

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F2.7 — asset-point bulk update", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: BulkUpdateFixtures;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const outOfScope = jwtFor(OTHER_LOCATION_ADMIN_EMAIL, "location_admin");

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

    // The organization is resolved through a *user's* grant rather than by
    // organization code, so the fixture follows the seed rather than a literal.
    // `wc-admin` is a location_admin of a DIFFERENT organization's location,
    // which is what makes the scope case a real refusal.
    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F2.7: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true
         ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error("F2.7: this organization needs an active location — run pnpm db:seed.");
    }
    const locationId = loc.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F2.7: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    // A **seeded** asset point of another organization: the cross-organization
    // case needs one that exists, and reading one rather than creating one
    // leaves nothing for the sweep to miss.
    const foreign = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.asset_points
        WHERE organization_id IS NOT NULL AND organization_id <> $1
        ORDER BY created_at, id LIMIT 1`,
      [organizationId],
    );
    if (!foreign.rows[0]) {
      throw new Error(
        "F2.7: the cross-organization case needs a seeded asset point in another " +
          "organization — run pnpm db:seed.",
      );
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    let targetIds: string[] = [];
    let computedPointId = "";

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
          name: "F2.7 bulk-update template",
          assetType: "test_rig",
          domain,
          status: "published",
          publishedAt: new Date(),
        })
        .returning({ id: assetTemplates.id });

      await tx.insert(templatePoints).values([
        { templateId: tpl.id, organizationId, pointKey: KEYS.plain, kind: "measured", sortOrder: 0 },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.banded,
          kind: "measured",
          sortOrder: 1,
          // The class default the merged-band refusal must name. Nothing in the
          // request under test carries `100`.
          engMax: 100,
        },
        { templateId: tpl.id, organizationId, pointKey: KEYS.third, kind: "measured", sortOrder: 2 },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.computed,
          kind: "derived",
          sortOrder: 3,
          formula: `{${KEYS.plain}} * 2`,
          formulaDialect: "bms-calc-v1",
          calcTrigger: "streaming",
        },
      ]);

      const [asset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: ASSET_CODE,
          name: "F2.7 bulk-update asset",
          siteName: "F2.7 Site",
          locationId,
          domain,
          templateId: tpl.id,
          active: true,
        })
        .returning({ id: assets.id });

      // Three `unmapped` measured rows and the calc surface's `computed` row.
      // `asset_points_source_ref_check` requires a null `rtu_id` on all four.
      const inserted = await tx
        .insert(assetPoints)
        .values([
          {
            assetId: asset.id,
            organizationId,
            pointKey: KEYS.plain,
            sourceDataKey: `${KEYS.plain}/RAW`,
            sourceKind: "unmapped",
            active: true,
          },
          {
            assetId: asset.id,
            organizationId,
            pointKey: KEYS.banded,
            sourceDataKey: `${KEYS.banded}/RAW`,
            sourceKind: "unmapped",
            active: true,
          },
          {
            assetId: asset.id,
            organizationId,
            pointKey: KEYS.third,
            sourceDataKey: `${KEYS.third}/RAW`,
            sourceKind: "unmapped",
            active: true,
          },
          {
            assetId: asset.id,
            organizationId,
            pointKey: KEYS.computed,
            sourceDataKey: `computed:${KEYS.computed}`,
            sourceKind: "computed",
            active: true,
          },
        ])
        .returning({ id: assetPoints.id, pointKey: assetPoints.pointKey });

      targetIds = inserted
        .filter((row) => row.pointKey !== KEYS.computed)
        .map((row) => row.id);
      computedPointId = inserted.find((row) => row.pointKey === KEYS.computed)?.id ?? "";
    });

    if (targetIds.length !== 3 || !computedPointId) {
      throw new Error("F2.7: the fixture did not create its four asset points");
    }

    ctx = {
      svc: new AssetPointsAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      fleetPool,
      assetCode: ASSET_CODE,
      targetIds,
      computedPointId,
      keys: KEYS,
      foreignPointId: foreign.rows[0].id,
      missingId: randomUUID(),
    };
  });

  afterAll(async () => {
    // Children first, on the owner pool, and the whole sweep in a `try` so a
    // single throw cannot leak four pools (the `E7.1b` bracket). `audit_log`
    // has no foreign key on `entity_id`, so it is joined back to this suite's
    // own assets before they go — and the join must run before the
    // `asset_points` delete removes what it joins through.
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

  it("applies one patch to every selected row, with one audit row each", async () => {
    await assertOnePatchLandsOnEverySelectedRow(ctx, jwt);
  });

  it("refuses the whole selection when one row's merged band is empty, naming that row", async () => {
    await assertAnInvertedMergedBandRefusesTheWholeSelection(ctx, jwt);
  });

  it("refuses a metadata patch that reaches a computed row, and writes nothing", async () => {
    await assertAComputedRowRefusesAMetadataPatch(ctx, jwt);
  });

  it("accepts the state flip alone, computed row included", async () => {
    await assertTheStateFlipAloneIsAccepted(ctx, jwt);
  });

  it("refuses a selection spanning two organizations", async () => {
    await assertASelectionSpanningTwoOrganizationsIsRefused(ctx, jwt);
  });

  it("names an id no row carries and writes nothing", async () => {
    await assertAnUnknownIdIsNamedAndNothingIsWritten(ctx, jwt);
  });

  it("refuses a caller who may not manage the rows' location", async () => {
    await assertACallerOutsideTheLocationIsRefused(ctx, outOfScope);
  });
});
