import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetsAdminService } from "./assets.service";
import {
  assertARenameRepairsASplitRow,
  assertCreateDerivesMqttFromTheAttachedRtu,
  assertCreateKeepsTheCallersOtherMetaKeys,
  assertCreateLeavesASimulatorRtusAssetOnCatalog,
  assertCreateOverridesACallerSuppliedTelemetrySource,
  assertCreateWithoutAnRtuLeavesTheMetaAlone,
  assertDetachLeavesTheStoredTelemetrySource,
  assertTheCreateAuditRecordsTheDerivedSource,
  assertUpdateDerivesFromTheNewRtuOnAChange,
  assertUpdateDerivesOnAttach,
  assertUpdateReappliesTheKeyWhenMetaIsPatched,
  type AssetsTelemetrySourceCtx,
} from "./assets.telemetry-source.integration.spec";

/**
 * `F4.139` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. The service graph is the
 * one `assets.service.rls.integration.test.ts` builds; the fixture and cleanup
 * lifecycle is the `F4.59` suite's, because a service call cannot be wrapped in
 * `withRollback` — `withTenant` opens its own transaction.
 */
const connectionString = requireIntegrationDb({
  item: "F4.139",
  label: "AssetsAdminService deriving assets.meta.telemetrySource from the RTU it attaches",
  because:
    "the derivation runs inside withTenant on a real bms_tenant connection and " +
    "reads rtu_connection_configs on that same transaction. Skipping leaves " +
    "nothing checking that attaching an asset to an ingest-enabled RTU takes it " +
    "off the simulator — and the failure is silent in both directions: two " +
    "writers on one (time, asset, point_key), or dead points.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000005";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F4.139 — AssetsAdminService derives telemetrySource", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AssetsTelemetrySourceCtx;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const createdAssetIds: string[] = [];
  const createdRtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039) — the fixture rows, the audit read-back and the meta
    // read-back all need to see across the tenant policy, and this is the same
    // pool the service reads on.
    fixturePool = await openIntegrationPool(url, "F4.139");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.139",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.139",
    );

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `F4.139: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }

    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `F4.139: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }

    // The domain is data (ADR 0031 Amendment 1) and `create` checks it against
    // `bms.asset_domains`, so read one rather than hard-coding a code.
    const dom = await fixturePool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.139: no active asset_domain — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    ctx = {
      svc: new AssetsAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        new VocabulariesService(fleetDb),
      ),
      fixturePool,
      organizationId: org.rows[0].id,
      locationId: loc.rows[0].id,
      domain: dom.rows[0].code,
      createdAssetIds,
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    // Assets first: `assets.rtu_id` references `rtus.id`, so the other order
    // leaves both behind on a foreign-key violation. This database is shared
    // with other suites and other worktrees — every fixture row carries an
    // `f4-139-` code so a leak names its author.
    if (createdAssetIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [
        createdAssetIds,
      ]);
      await fixturePool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    if (createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  // One claim per `it`: `expect` throws, so a second claim in the same block
  // would never run on the first one's failure.
  it("derives mqtt on create from the RTU it attaches", async () => {
    await assertCreateDerivesMqttFromTheAttachedRtu(ctx, jwt);
  }, 30_000);

  it("keeps the caller's other meta keys on create", async () => {
    await assertCreateKeepsTheCallersOtherMetaKeys(ctx, jwt);
  }, 30_000);

  it("overrides a caller-supplied telemetrySource on create", async () => {
    await assertCreateOverridesACallerSuppliedTelemetrySource(ctx, jwt);
  }, 30_000);

  it("leaves a simulator RTU's new asset on catalog", async () => {
    await assertCreateLeavesASimulatorRtusAssetOnCatalog(ctx, jwt);
  }, 30_000);

  it("stores the meta untouched when no RTU is attached", async () => {
    await assertCreateWithoutAnRtuLeavesTheMetaAlone(ctx, jwt);
  }, 30_000);

  it("derives mqtt when an update attaches an RTU", async () => {
    await assertUpdateDerivesOnAttach(ctx, jwt);
  }, 30_000);

  it("derives from the new RTU when an update changes it", async () => {
    await assertUpdateDerivesFromTheNewRtuOnAChange(ctx, jwt);
  }, 30_000);

  it("reapplies the key when a PATCH replaces the meta bag", async () => {
    await assertUpdateReappliesTheKeyWhenMetaIsPatched(ctx, jwt);
  }, 30_000);

  it("repairs a split row on a PATCH that only renames the asset", async () => {
    await assertARenameRepairsASplitRow(ctx, jwt);
  }, 30_000);

  it("leaves the stored telemetrySource alone when the RTU is detached", async () => {
    await assertDetachLeavesTheStoredTelemetrySource(ctx, jwt);
  }, 30_000);

  it("records the derived telemetrySource in the create audit payload", async () => {
    await assertTheCreateAuditRecordsTheDerivedSource(ctx, jwt);
  }, 30_000);
});
