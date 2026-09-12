import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "./rtus.service";
import {
  assertAConnectionConfigLetsTheAssetsMove,
  assertACrossOrgAssetDoesNotBreakTheUpdate,
  assertAForeignOrgAssetIsNotMovedByThePredicate,
  assertAnUndeclaredRtuKeepsItsAssetsOnCatalog,
  assertARenameRepairsASplitRow,
  assertASimulatorRtuKeepsItsAssetsOnCatalog,
  assertTheAuditCountsOnlyTheAssetsItMoved,
  assertDisablingIngestMovesAssetsOffMqtt,
  assertEnablingIngestMovesAssetsToMqtt,
  assertOnlyTheUpdatedRtusAssetsMove,
  assertTheMoveMergesTheAssetMetaBag,
  type TelemetrySourceCtx,
} from "./rtus.telemetry-source.integration.spec";

/**
 * `F4.59` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `rtus.service.rls.integration.test.ts`, which covers the other half of this
 * service's write path.
 */
const connectionString = requireIntegrationDb({
  item: "F4.59",
  label: "RtusAdminService moving assets.meta.telemetrySource with ingest_enabled",
  because:
    "the invariant apps/sim and the ingest host divide the fleet by lives in a " +
    "jsonb column the database merges, and it spans two tables in one " +
    "transaction. Skipping leaves nothing checking that enabling an RTU stops " +
    "the simulator writing its assets, or that disabling one starts it again — " +
    "and both failures are silent: duplicate writers on one sample, or dead points.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000004";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F4.59 — telemetrySource moves with ingest_enabled", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: TelemetrySourceCtx;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const createdRtuIds: string[] = [];
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039) — the fixture rows and the read-back need to see across
    // the tenant policy, and this is the same pool the service reads on.
    fixturePool = await openIntegrationPool(url, "F4.59");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.59",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.59",
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
        `F4.59: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }

    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `F4.59: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    ctx = {
      svc: new RtusAdminService(
        fleetDb,
        tenantDb,
        accessControl,
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      // `bms_fleet` in the tenant slot — see `TelemetrySourceCtx`. The graph is
      // otherwise identical, so the case exercises the same code path.
      svcOnABypassingTenantChannel: new RtusAdminService(
        fleetDb,
        fleetDb,
        accessControl,
        new MasterDataAuditService(fleetDb, fleetDb),
      ),
      fixturePool,
      organizationId: org.rows[0].id,
      locationId: loc.rows[0].id,
      createdRtuIds,
      createdAssetIds,
    };
  }, 60_000);

  afterAll(async () => {
    // Assets first: `assets.rtu_id` references `rtus.id`, so the other order
    // leaves both behind on a foreign-key violation. This database is shared
    // with other suites and other worktrees — every fixture row carries an
    // `f4-59-` code so a leak names its author.
    if (createdAssetIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    if (createdRtuIds.length > 0) {
      // The audit rows these cases wrote go too. They are this suite's own
      // exhaust, not history anyone wants, and `bms.audit_log` is on the shared
      // 5433 database with every other suite's.
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [
        createdRtuIds,
      ]);
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  // One claim per `it`: `expect` throws, so two directions in one block would
  // hide the second whenever the first fails.
  it("moves the RTU's assets onto mqtt when ingest is enabled", async () => {
    await assertEnablingIngestMovesAssetsToMqtt(ctx, jwt);
  }, 30_000);

  it("moves them back off mqtt when ingest is disabled", async () => {
    await assertDisablingIngestMovesAssetsOffMqtt(ctx, jwt);
  }, 30_000);

  it("merges assets.meta rather than replacing the shared bag", async () => {
    await assertTheMoveMergesTheAssetMetaBag(ctx, jwt);
  }, 30_000);

  it("leaves another RTU's assets alone", async () => {
    await assertOnlyTheUpdatedRtusAssetsMove(ctx, jwt);
  }, 30_000);

  it("leaves the assets of an RTU that declares no protocol on catalog", async () => {
    await assertAnUndeclaredRtuKeepsItsAssetsOnCatalog(ctx, jwt);
  }, 30_000);

  it("leaves the assets of a simulator RTU on catalog", async () => {
    await assertASimulatorRtuKeepsItsAssetsOnCatalog(ctx, jwt);
  }, 30_000);

  it("repairs a split row on a PATCH that does not mention ingest", async () => {
    await assertARenameRepairsASplitRow(ctx, jwt);
  }, 30_000);

  it("moves them when a connection config declares the protocol instead", async () => {
    await assertAConnectionConfigLetsTheAssetsMove(ctx, jwt);
  }, 30_000);

  it("leaves a foreign organization's asset behind on the predicate alone", async () => {
    await assertAForeignOrgAssetIsNotMovedByThePredicate(ctx, jwt);
  }, 30_000);

  it("audits the number of assets it actually moved", async () => {
    await assertTheAuditCountsOnlyTheAssetsItMoved(ctx, jwt);
  }, 30_000);

  it("still answers 200 with a foreign organization's asset attached", async () => {
    await assertACrossOrgAssetDoesNotBreakTheUpdate(ctx, jwt);
  }, 30_000);
});
