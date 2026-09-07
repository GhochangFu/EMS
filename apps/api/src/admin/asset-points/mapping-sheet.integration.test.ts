import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assetPoints, assetTemplates, assets, createDb, locations, pointKeys, rtus, templatePoints } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertADuplicateSourceKeyIsARowErrorAndTheRestStillLand,
  assertAFailedAuditRollsBackEveryWrittenRow,
  assertAnOutOfScopeCallerIsRefusedBeforeTheFileIsRead,
  assertARetiredRtuRoundTripsButCannotBeNewlyWired,
  assertAThirteenthColumnRefusesTheWholeFile,
  assertExportThenImportIsIdentity,
  assertPreviewListsErrorsAndCommitWritesTheValidRows,
  assertTwoRowsSwapTheirSourceKeysInOneCommit,
  type MappingSheetFixtures,
} from "./mapping-sheet.integration.spec";
import { MappingSheetService } from "./mapping-sheet.service";

/**
 * `F2.7` Unit H — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle and the fixtures, the same
 * four-role shape as `asset-points.metadata.integration.test.ts`.
 *
 * **The fixture is a whole location this run builds** — its own
 * `bms.locations` row, two RTUs (one retired), a published template with three
 * measured points, and six assets. A seeded location would make the identity
 * test's `unchanged` and `untouchedSuggestions` counts depend on a shape that
 * belongs to another item, and correction 39's retired RTU does not exist in
 * the seed at all.
 */
const connectionString = requireIntegrationDb({
  item: "F2.7",
  label: "the mapping sheet: export, preview and a one-transaction commit",
  because:
    "every rule here is a property of rows the pure modules never see. The identity round " +
    "trip is over a location the service itself read; the three-phase re-key exists only " +
    "because asset_points_asset_source_key_idx is checked per statement inside the " +
    "transaction; the audit rows are written under 0048's strict WITH CHECK; and the scope " +
    "refusal is canManageLocation against real grant rows. Without a database this suite " +
    "would re-test the planner and none of the behaviour the routes actually have.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const OTHER_LOCATION_ADMIN_EMAIL = "wc-admin@bms.local";
const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000007";

// Per-run fixture prefixes (`F4.65`). `afterAll` sweeps with `DELETE ... WHERE
// code LIKE` on the owner pool, which sees every organization's rows, so a
// family-wide prefix would reap a concurrent instance's committed fixtures.
// Each prefix carries its own `randomUUID()` in its own declaration, because
// `tests/integration-fixture-isolation.test.ts` reads that declaration
// literally to decide the sweep is run-unique.
const ASSET_PREFIX = `F27-MS-${randomUUID().replace(/-/g, "").slice(0, 8)}-`;
const POINT_KEY_PREFIX = `F27_MS_${randomUUID().replace(/-/g, "").slice(0, 8)}_`;

const LOCATION_CODE = `${ASSET_PREFIX}LOC`;
const TEMPLATE_CODE = `${ASSET_PREFIX}TPL`;
const RTU_CODE = `${ASSET_PREFIX}RTU`;
const RETIRED_RTU_CODE = `${ASSET_PREFIX}RTURET`;

/**
 * Six assets, one per case, so no case can be made to pass by another's rows —
 * and so the identity test, which runs first and reads the whole location, sees
 * every one of them.
 */
const ASSETS = {
  withOneRow: `${ASSET_PREFIX}A1`,
  bare: `${ASSET_PREFIX}A2`,
  swap: `${ASSET_PREFIX}A3`,
  duplicate: `${ASSET_PREFIX}A4`,
  retired: `${ASSET_PREFIX}A5`,
  creates: `${ASSET_PREFIX}A6`,
} as const;

/** Four catalog point keys, all per-run so none is a row a concurrent instance also wants. */
const KEYS = {
  kw: `${POINT_KEY_PREFIX}KW`,
  kwh: `${POINT_KEY_PREFIX}KWH`,
  pressure: `${POINT_KEY_PREFIX}PRESSURE`,
  temp: `${POINT_KEY_PREFIX}TEMP`,
} as const;

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F2.7 — the MAPPINGS sheet: export, preview, commit", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: MappingSheetFixtures;

  const jwt = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");
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

    let locationId = "";

    // One tenant GUC for every parent: `locations`, `rtus`, `point_keys`,
    // `asset_templates`, `assets` and `asset_points` are policied with FORCE,
    // and the GUC is what their WITH CHECK reads.
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: LOCATION_CODE,
          slug: LOCATION_CODE.toLowerCase(),
          name: "F2.7 mapping sheet site",
          type: "rsmoc",
          latitude: 0,
          longitude: 0,
          active: true,
        })
        .returning({ id: locations.id });
      locationId = location.id;

      // Two gateways: one live, one retired. The retired one is correction 39's
      // whole subject — a row wired to it must still export its code and read
      // back as no change.
      const [liveRtu, retiredRtu] = await tx
        .insert(rtus)
        .values([
          { organizationId, locationId, code: RTU_CODE, displayName: "F2.7 live gateway", active: true },
          { organizationId, locationId, code: RETIRED_RTU_CODE, displayName: "F2.7 retired gateway", active: false },
        ])
        .returning({ id: rtus.id });

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
          name: "F2.7 mapping sheet template",
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
          pointKey: KEYS.kw,
          kind: "measured",
          unit: "kW",
          sourceDataKeyPattern: "{asset_code}_KW",
          sortOrder: 0,
        },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.kwh,
          kind: "measured",
          unit: "kWh",
          sourceDataKeyPattern: "{asset_code}_KWH",
          sortOrder: 1,
          // The class default the merged-pair refusal must name. Nothing in the
          // sheet under test carries `100`.
          engMax: 100,
        },
        {
          templateId: tpl.id,
          organizationId,
          pointKey: KEYS.pressure,
          kind: "measured",
          unit: "bar",
          sourceDataKeyPattern: "{asset_code}_P",
          sortOrder: 2,
        },
      ]);

      const assetRows = await tx
        .insert(assets)
        .values(
          (
            [
              [ASSETS.withOneRow, liveRtu.id],
              [ASSETS.bare, null],
              [ASSETS.swap, liveRtu.id],
              [ASSETS.duplicate, liveRtu.id],
              [ASSETS.retired, retiredRtu.id],
              [ASSETS.creates, liveRtu.id],
            ] as ReadonlyArray<readonly [string, string | null]>
          ).map(([code, rtuId]) => ({
            organizationId,
            code,
            name: `F2.7 ${code}`,
            siteName: "F2.7 Site",
            locationId,
            domain,
            templateId: tpl.id,
            rtuId,
            active: true,
          })),
        )
        .returning({ id: assets.id, code: assets.code });
      const idOf = new Map(assetRows.map((row) => [row.code, row.id]));

      // Seven existing rows. Every one restates cleanly through the export, which
      // is what makes the identity test's `unchanged` count non-zero — the
      // retired-RTU row is the one that would break it without correction 39,
      // and the `unit = ''` row the one that broke it on the running stack (52
      // seeded Western Cape rows store an empty unit; the sheet shows a blank,
      // and the snapshot must read `''` as `null` or the round trip reports a
      // change nobody made).
      await tx.insert(assetPoints).values([
        {
          assetId: idOf.get(ASSETS.withOneRow) as string,
          organizationId,
          pointKey: KEYS.kw,
          sourceDataKey: `${ASSETS.withOneRow}_KW`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "kW",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.withOneRow) as string,
          organizationId,
          pointKey: KEYS.temp,
          sourceDataKey: `${ASSETS.withOneRow}_TEMP`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.swap) as string,
          organizationId,
          pointKey: KEYS.kw,
          sourceDataKey: `${ASSETS.swap}_KW`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "kW",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.swap) as string,
          organizationId,
          pointKey: KEYS.kwh,
          sourceDataKey: `${ASSETS.swap}_KWH`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "kWh",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.duplicate) as string,
          organizationId,
          pointKey: KEYS.kw,
          sourceDataKey: `${ASSETS.duplicate}_KW`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "kW",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.duplicate) as string,
          organizationId,
          pointKey: KEYS.kwh,
          sourceDataKey: `${ASSETS.duplicate}_KWH`,
          sourceKind: "measured",
          rtuId: liveRtu.id,
          unit: "kWh",
          active: true,
        },
        {
          assetId: idOf.get(ASSETS.retired) as string,
          organizationId,
          pointKey: KEYS.temp,
          sourceDataKey: `${ASSETS.retired}_TEMP`,
          sourceKind: "measured",
          rtuId: retiredRtu.id,
          unit: "degC",
          active: true,
        },
      ]);
    });

    const build = (audit: MasterDataAuditService): MappingSheetService =>
      new MappingSheetService(fleetDb, tenantDb, new AccessControlService(authDb, fleetDb), audit);

    // The rollback probe: `writeMany` is the commit's last statement, so a throw
    // there proves the inserts and updates before it are rolled back with it.
    const failingAudit = new MasterDataAuditService(tenantDb, fleetDb);
    failingAudit.writeMany = async () => {
      throw new Error("F2.7 integration: injected audit failure");
    };

    ctx = {
      svc: build(new MasterDataAuditService(tenantDb, fleetDb)),
      failingAuditSvc: build(failingAudit),
      fleetPool,
      locationId,
      locationCode: LOCATION_CODE,
      assetPrefix: ASSET_PREFIX,
      rtuCode: RTU_CODE,
      retiredRtuCode: RETIRED_RTU_CODE,
      assets: ASSETS,
      keys: KEYS,
    };
  });

  afterAll(async () => {
    // Children first, on the owner pool, and the whole sweep in a `try` so a
    // single throw cannot leak four pools (the `E7.1b` bracket). `audit_log` has
    // no foreign key on `entity_id`, so it is joined back to this suite's own
    // points BEFORE they go; `locations` goes last, after everything that
    // references it.
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
        await ownerPool.query(`DELETE FROM bms.rtus WHERE code LIKE $1`, [`${ASSET_PREFIX}%`]);
        // `template_points` cascade on the FK when the template goes, and they
        // reference the catalog codes swept after them.
        await ownerPool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${ASSET_PREFIX}%`]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [`${POINT_KEY_PREFIX}%`]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${ASSET_PREFIX}%`]);
      }
    } finally {
      await Promise.all([ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
    }
  });

  // (1) runs first and deliberately: it reads the whole location, and every
  // case after it mutates rows.
  it("(1) exports a location and imports that very file as the identity", async () => {
    await assertExportThenImportIsIdentity(ctx, jwt);
  });

  it("(2) previews four rows by row and column, and commits exactly the two valid ones", async () => {
    await assertPreviewListsErrorsAndCommitWritesTheValidRows(ctx, jwt);
  });

  it("(3) refuses a thirteen-column header on the whole file and writes nothing", async () => {
    await assertAThirteenthColumnRefusesTheWholeFile(ctx, jwt);
  });

  it("(4) makes a duplicate source key a row error while the other rows still land", async () => {
    await assertADuplicateSourceKeyIsARowErrorAndTheRestStillLand(ctx, jwt);
  });

  it("(5) refuses a caller outside the location's scope before the file is read", async () => {
    await assertAnOutOfScopeCallerIsRefusedBeforeTheFileIsRead(ctx, outOfScope);
  });

  it("(6) rolls every written row back when the audit write throws", async () => {
    await assertAFailedAuditRollsBackEveryWrittenRow(ctx, jwt);
  });

  it("(7) swaps two rows' source keys in one commit (correction 38)", async () => {
    await assertTwoRowsSwapTheirSourceKeysInOneCommit(ctx, jwt);
  });

  it("(8) round-trips a retired RTU's code but refuses a new wiring to it (correction 39)", async () => {
    await assertARetiredRtuRoundTripsButCannotBeNewlyWired(ctx, jwt);
  });
});
