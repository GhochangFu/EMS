import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { alarms, assets, createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { AlarmsService } from "./alarms.service";
import type { AlarmsGateway } from "./alarms.gateway";
import {
  assertAcknowledgeRefusesForeignAlarmButAllowsInScope,
  assertAlarmListReturnsBothOrgsForTwoOrgActor,
  assertAlarmListScopedByAssetIds,
  assertSingleOrgListRunsOnTenantTransaction,
  type AlarmsRlsFixtures,
} from "./alarms.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one asset + alarm
 * in each of two organizations through `bms_tenant`, then drives the alarm read
 * path with a real `bms_tenant`/`bms_fleet` pair and proves the `assetIds`
 * filter — not the owner connection's RLS bypass — is what isolates.
 *
 * The fixture creates NO location (it reuses seeded active locations), so it
 * cannot re-open the seed-breaker E7.1a closed. Cleanup is by per-run code.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "AlarmsService read path against real, non-owner roles",
  because:
    "AlarmsService.list/resolveAlarmOrg read alarms on fleetDb behind the caller's assetIds, and the " +
    "service had no test of any kind. Constructing it with real bms_tenant/bms_fleet connections is the " +
    "only proof the assetIds filter isolates across organizations, that a bare tenant pool would go dark " +
    "under the 0047 FORCE policy, and that acknowledge refuses a foreign alarm and resolves the actor on " +
    "fleetDb — rather than passing because the owner connection bypasses RLS.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000009";

// Per-run fixture prefix (F4.65). afterAll narrows every sweep to this run's
// code, so a concurrent instance's rows are never reaped. randomUUID() sits in
// PREFIX's own declaration because the isolation invariant
// (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `E71B-AL-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const SUITE_START = new Date();

// The read path never emits, but acknowledge broadcasts — a no-op gateway keeps
// the write assertion from needing a Socket.IO server.
const gatewayStub = {
  broadcastAcknowledged: () => undefined,
} as unknown as AlarmsGateway;

describe.skipIf(!connectionString)("E7.1b — alarm reads isolate by assetIds under real RLS", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AlarmsRlsFixtures;

  const actor: Pick<JwtPayload, "sub" | "email"> = {
    sub: SYNTHETIC_SUB,
    email: ORGANIZATION_ADMIN_EMAIL,
  };

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "E7.1b"); // fleet (BYPASSRLS) by default
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );

    // org A = the acting admin's org; org B = any other seeded org. Both need an
    // active location to hang the asset on.
    const orgA = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!orgA.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const orgAId = orgA.rows[0].id;

    const orgB = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [orgAId],
    );
    if (!orgB.rows[0]) {
      throw new Error("E7.1b: need a second seeded organization for the cross-org proof.");
    }
    const orgBId = orgB.rows[0].id;

    const usr = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.users WHERE email = $1 LIMIT 1",
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!usr.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);
    }
    const actorUserId = usr.rows[0].id;

    const dom = await fleetPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const sev = await fleetPool.query<{ code: string }>(
      "SELECT code FROM bms.alarm_severities LIMIT 1",
    );
    if (!sev.rows[0]) {
      throw new Error("E7.1b: no alarm_severities row — run pnpm db:seed.");
    }
    const severity = sev.rows[0].code;

    const tenantDb = createDb(tenantPool);

    // Seed one asset + one alarm in each org inside that org's GUC, so the
    // FORCE-policied writes pass their WITH CHECK. Returns the ids the assertions
    // key on.
    const seed = async (
      orgId: string,
      code: string,
    ): Promise<{ assetId: string; alarmId: string }> => {
      const loc = await fleetPool.query<{ id: string }>(
        "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
        [orgId],
      );
      if (!loc.rows[0]) {
        throw new Error(`E7.1b: organization ${orgId} has no active location — run pnpm db:seed.`);
      }
      return withTenant(tenantDb, orgId, async (tx) => {
        const [asset] = await tx
          .insert(assets)
          .values({
            organizationId: orgId,
            code,
            name: "E7.1b alarm read-path asset",
            siteName: "E7.1b Site",
            locationId: loc.rows[0].id,
            domain,
            active: true,
          })
          .returning({ id: assets.id });
        const [alarm] = await tx
          .insert(alarms)
          .values({
            organizationId: orgId,
            assetId: asset.id,
            severity,
            message: `E7.1b alarm for ${code}`,
          })
          .returning({ id: alarms.id });
        return { assetId: asset.id, alarmId: alarm.id };
      });
    };

    const inScope = await seed(orgAId, `${PREFIX}A`);
    const foreign = await seed(orgBId, `${PREFIX}B`);

    const fleetDb = createDb(fleetPool);
    const makeService = (t: BmsDb, f: BmsDb): AlarmsService =>
      new AlarmsService(t, f, gatewayStub);
    ctx = {
      svc: makeService(tenantDb, fleetDb),
      tenantDb,
      fleetDb,
      makeService,
      ownerPool: fleetPool,
      organizationId: orgAId,
      inScopeAssetId: inScope.assetId,
      inScopeAlarmId: inScope.alarmId,
      foreignAssetId: foreign.assetId,
      foreignAlarmId: foreign.alarmId,
      actorUserId,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await fleetPool.query(
        `DELETE FROM bms.audit_log
          WHERE actor_id = (SELECT id FROM bms.users WHERE email = $1)
            AND created_at >= $2 AND action LIKE 'alarm%'`,
        [ORGANIZATION_ADMIN_EMAIL, SUITE_START],
      );
      await fleetPool.query(
        `DELETE FROM bms.alarms
          WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${PREFIX}%`],
      );
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
    }
    await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("lists each org's own alarm behind its own assetIds, under that org's GUC", async () => {
    await assertAlarmListScopedByAssetIds(ctx);
  });

  it("returns both orgs' alarms for a two-organization actor on one read (decision 3)", async () => {
    await assertAlarmListReturnsBothOrgsForTwoOrgActor(ctx);
  });

  it("runs a single-org list on the tenant pool (one tenant transaction, no fleet)", async () => {
    await assertSingleOrgListRunsOnTenantTransaction(ctx);
  });

  it("refuses acknowledging a foreign alarm and acknowledges an in-scope one under the org GUC", async () => {
    await assertAcknowledgeRefusesForeignAlarmButAllowsInScope(ctx, actor);
  });
});
