import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertALocationTargetWritesNoTelemetrySource,
  assertInstantiateDerivesCatalogForASimulatorRtu,
  assertInstantiateDerivesMqttForEveryAssetInTheBatch,
  assertTheBatchDerivesFromTheRtuAsItIsAtInsertTime,
  FIXTURE_PREFIX,
  type InstantiateTelemetrySourceCtx,
} from "./asset-templates-instantiate.telemetry-source.integration.spec";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F4.139` — Vitest entry point for the third `assets.rtu_id` writer.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 *
 * A new pair rather than three more cases in
 * `asset-templates.instantiate.integration.test.ts`: that suite is 830 lines
 * about rollback and access control, its fixtures are the location admin's, and
 * its `cleanup` is prefix-wide. Sharing it would have made these cases depend on
 * its fixture template surviving unchanged.
 *
 * The service graph is the one that suite builds, which is the one `AdminModule`
 * wires. The fixture and cleanup lifecycle is the `F4.59` suite's: tracked ids,
 * prefixed codes, `afterAll` deletes — an instantiate call cannot be wrapped in
 * `withRollback`, because `withTenant` opens its own transaction.
 */
const connectionString = requireIntegrationDb({
  item: "F4.139",
  label: "AssetTemplateInstantiationService deriving assets.meta.telemetrySource",
  because:
    "instantiate writes N assets carrying target.rtuId in one transaction, and the " +
    "derivation reads rtu_connection_configs on that same tenant transaction. " +
    "Skipping leaves nothing checking the bulk path — the one screen that can put a " +
    "whole commissioning batch on two producers at once, or on none.",
});

const ADMIN_EMAIL = "admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!connectionString)("F4.139 — instantiate derives telemetrySource", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: InstantiateTelemetrySourceCtx;

  const jwt: JwtPayload = {
    sub: SYNTHETIC_SUB,
    email: ADMIN_EMAIL,
    name: "integration:admin",
    role: "admin",
  };
  const createdAssetIds: string[] = [];
  const createdRtuIds: string[] = [];
  let templateId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039): the fixture RTUs and the `meta` read-back both have to
    // see across the tenant policy.
    fixturePool = await openIntegrationPool(url, "F4.139");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.139",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.139",
    );

    // An active location with an organization — the template, the RTUs and the
    // assets all live in it, so `resolveTarget`'s org check passes on both the
    // RTU and the location branch.
    const loc = await fixturePool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations
        WHERE active = true AND organization_id IS NOT NULL
        ORDER BY created_at, code LIMIT 1`,
    );
    if (!loc.rows[0]) {
      throw new Error("F4.139: no active location with an organization — run pnpm db:seed.");
    }

    // The point key is read, never hard-coded: the catalog is data (`F3.39`) and
    // `assertCatalogActive` re-checks every key at instantiate time.
    const key = await fixturePool.query<{ code: string }>(
      "SELECT code FROM bms.point_keys WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    if (!key.rows[0]) {
      throw new Error("F4.139: no active point key — run pnpm db:seed.");
    }
    const dom = await fixturePool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.139: no active asset_domain — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(fleetDb);
    const templates = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
    );
    // F3.2 / ADR 0067 decision 4 — the REAL dashboards service, never a stub.
    // The constructor parameter is required, so a stub here would leave the
    // instantiate hook inert in every suite that builds the service by hand.
    const assetDashboards = new AssetDashboardsInstantiateService(
      fleetDb,
      tenantDb,
      new AssetTemplatesAdminService(fleetDb, tenantDb, access, audit, vocabularies),
      audit,
    );
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      assetDashboards,
    );

    // One measured point, no alarms: this suite asserts `bms.assets.meta` only,
    // and every extra point or rule is another row to clean up.
    const draft = await templates.create(jwt, {
      organizationId: loc.rows[0].organization_id,
      code: `${FIXTURE_PREFIX}-TMPL-${Date.now()}`,
      name: "F4.139 telemetrySource fixture",
      assetType: "f4139_skid",
      domain: dom.rows[0].code,
      points: [
        {
          pointKey: key.rows[0].code,
          kind: "measured",
          required: true,
          sortOrder: 0,
          sourceDataKeyPattern: "{asset_code}_P",
        },
      ],
    });
    const published = await templates.publish(jwt, draft.id);
    templateId = published.id;

    ctx = {
      instantiate: (actor, id, body) =>
        instantiation.instantiate(actor, id, instantiateAssetsBodySchema.parse(body)),
      fixturePool,
      organizationId: loc.rows[0].organization_id,
      locationId: loc.rows[0].id,
      templateId: published.id,
      createdAssetIds,
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    // Children first: `asset_points.asset_id` and `assets.rtu_id` are foreign
    // keys, so the other order leaves every row behind on a violation. This
    // database is shared with other suites and other worktrees — every fixture
    // row carries the `F4139-INST` prefix so a leak names its author.
    if (createdAssetIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1)", [
        createdAssetIds,
      ]);
      await fixturePool.query("DELETE FROM bms.automation_rules WHERE asset_id = ANY($1)", [
        createdAssetIds,
      ]);
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [
        createdAssetIds,
      ]);
      await fixturePool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    if (createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    if (templateId !== undefined) {
      // `template_points` cascade on the FK.
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = $1", [templateId]);
      await fixturePool.query("DELETE FROM bms.asset_templates WHERE id = $1", [templateId]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  // One claim per `it`: `expect` throws, so a second claim in the same block
  // would never run on the first one's failure.
  it("derives mqtt for every asset in a batch on an ingest-enabled RTU", async () => {
    await assertInstantiateDerivesMqttForEveryAssetInTheBatch(ctx, jwt);
  }, 30_000);

  it("derives catalog for every asset in a batch on a simulator RTU", async () => {
    await assertInstantiateDerivesCatalogForASimulatorRtu(ctx, jwt);
  }, 30_000);

  it("writes no telemetrySource at all for a gateway-less location target", async () => {
    await assertALocationTargetWritesNoTelemetrySource(ctx, jwt);
  }, 30_000);

  it("derives from the RTU row as it is at insert time", async () => {
    await assertTheBatchDerivesFromTheRtuAsItIsAtInsertTime(ctx, jwt);
  }, 30_000);
});
