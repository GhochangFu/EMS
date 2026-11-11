import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { alarms, assets, createDb, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { deleteFixtureUsers, deleteWorkOrderEvents } from "../testing/work-order-events-cleanup";
import {
  assertAFailedAuditLeavesNoChangeAndNoEvent,
  assertASameAssigneeReSentWritesNoEvent,
  assertAForeignSettingCannotFileAnEvent,
  assertARenameDoesNotRewriteHistory,
  assertCreateWritesItsFirstEvents,
  assertReorderWritesOneEventPerStatusChange,
  assertStatusAndAssigneeChangesWriteEvents,
  assertTheAuditPayloadNamesTheTicket,
  assertTheDetailReadIsScopedAndOrdered,
  assertTheSavedNameIsTheDisplayName,
  assertTheTimelineIsAppendOnlyOnBothPools,
  type WorkOrderEventsFixtures,
} from "./work-order-events.integration.spec";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 7 and 8) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order timeline writer and detail read against real, non-owner roles",
  because:
    "the timeline's two guarantees live in Postgres, not in code: UPDATE and DELETE are revoked from " +
    "bms_tenant and bms_fleet, and the policy's EXISTS refuses an event filed against another " +
    "organization's work order. Only real pool roles prove either, and only a real transaction " +
    "proves that a failed audit write takes the change and its event down with it.",
});

// Per-run fixture prefix (F4.65): randomUUID() sits in PREFIX's own declaration because
// the isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-EVT-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const FIXTURE_USER_EMAIL = `${PREFIX.toLowerCase()}user@bms.invalid`;
const FIXTURE_USER_NAME = "E3.1 Fixture User";

/**
 * Reaps rows a *killed* earlier run of this suite committed but never cleaned. Every
 * statement is age-bounded, so a concurrent instance's rows (seconds old) are out of
 * reach. Non-fatal: per-run codes mean a leftover cannot collide with this run.
 */
async function sweepStaleRuns(fleet: pg.Pool, superuserUrl: string): Promise<void> {
  const staleFamily = `${FAMILY}%`;
  try {
    await deleteWorkOrderEvents(superuserUrl, { assetCodeLike: staleFamily, olderThanMinutes: 30 });
    for (const table of ["work_orders", "alarms"]) {
      await fleet.query(
        `DELETE FROM bms.${table}
          WHERE asset_id IN (
            SELECT id FROM bms.assets
             WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'
          )`,
        [staleFamily],
      );
    }
    await fleet.query(`DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [staleFamily]);
    await fleet.query(`DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      staleFamily,
    ]);
    await deleteFixtureUsers(superuserUrl, { emailLike: `${FAMILY.toLowerCase()}%`, olderThanMinutes: 30 });
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — work-order timeline under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: WorkOrderEventsFixtures;
  let fixtureUserId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E3.1",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E3.1",
    );
    await primeSeededSubjects(fleetPool);
    const actor = jwtFor(SEEDED.organizationAdmin, "organization_admin");
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

    const userRow = async (email: string): Promise<{ id: string; display_name: string }> => {
      const { rows } = await fleetPool.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM bms.users WHERE email = $1 LIMIT 1",
        [email],
      );
      if (!rows[0]) throw new Error(`E3.1: ${email} is not seeded — run pnpm db:seed.`);
      return rows[0];
    };
    const actorRow = await userRow(SEEDED.organizationAdmin);
    const adminRow = await userRow(SEEDED.globalAdmin);
    const actorUserId = actorRow.id;

    await sweepStaleRuns(fleetPool, resolveIntegrationRoleUrl(url, "superuser", process.env));

    // The organization admin's own organization: its user is an active user there, so
    // it can be an assignee. Nothing in this suite asserts a counter value, so sharing
    // the organization with other suites is safe.
    const org = await fleetPool.query<{ id: string }>(
      "SELECT organization_id AS id FROM bms.user_organization_access WHERE user_id = $1 LIMIT 1",
      [actorUserId],
    );
    if (!org.rows[0]) throw new Error(`E3.1: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;

    // The suite's own user, for the rename proof. A viewer with no grant: the service takes
    // its scope as an argument, and this user only needs a name to save.
    const fixture = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.users (email, display_name, role, organization_id) VALUES ($1, $2, 'viewer', $3) RETURNING id",
      [FIXTURE_USER_EMAIL, FIXTURE_USER_NAME, organizationId],
    );
    fixtureUserId = fixture.rows[0]?.id ?? "";
    if (!fixtureUserId) throw new Error("E3.1: the fixture user was not created");

    const other = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    if (!other.rows[0]) throw new Error("E3.1: need a second seeded organization — run pnpm db:seed.");

    const domain = await fleetPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE code = 'electrical'");
    const severity = await fleetPool.query<{ code: string }>("SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1");
    if (!domain.rows[0] || !severity.rows[0]) throw new Error("E3.1: vocabularies are not seeded — run pnpm db:seed.");

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const ids = await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: `${PREFIX}LOC`,
          slug: `${PREFIX.toLowerCase()}loc`,
          name: "E3.1 events location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const asset = async (suffix: string): Promise<string> => {
        const [row] = await tx
          .insert(assets)
          .values({
            organizationId,
            code: `${PREFIX}${suffix}`,
            name: `E3.1 ${suffix}`,
            siteName: "E3.1 Site",
            locationId: loc.id,
            domain: "electrical",
            active: true,
          })
          .returning({ id: assets.id });
        return row.id;
      };
      const assetId = await asset("A1");
      const otherAssetId = await asset("A2");
      const [alarm] = await tx
        .insert(alarms)
        .values({ organizationId, assetId, severity: severity.rows[0].code, message: "E3.1 events fixture alarm" })
        .returning({ id: alarms.id });
      return { assetId, otherAssetId, alarmId: alarm.id };
    });

    const failingAudit = {
      write: async (): Promise<never> => {
        throw new Error("audit is down");
      },
      writeMany: async (): Promise<never> => {
        throw new Error("audit is down");
      },
    } as unknown as MasterDataAuditService;
    const service = (audit: MasterDataAuditService, t: BmsDb, f: BmsDb): WorkOrdersService => new WorkOrdersService(f, t, audit);

    ctx = {
      svc: service(new MasterDataAuditService(tenantDb, fleetDb), tenantDb, fleetDb),
      svcWithFailingAudit: service(failingAudit, tenantDb, fleetDb),
      tenantDb,
      tenantPool,
      fleetPool,
      actor,
      actorUserId,
      actorDisplayName: actorRow.display_name,
      globalAdmin,
      globalAdminDisplayName: adminRow.display_name,
      organizationId,
      foreignOrgId: other.rows[0].id,
      fixtureUser: { sub: fixtureUserId, email: FIXTURE_USER_EMAIL },
      fixtureUserId,
      fixtureUserDisplayName: FIXTURE_USER_NAME,
      ...ids,
    };
  });

  afterAll(async () => {
    // Children first. The timeline is append-only for the fleet role, so its rows go
    // through the superuser helper; everything else on the BYPASSRLS fleet connection.
    if (fleetPool) {
      await deleteWorkOrderEvents(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), { assetCodeLike: `${PREFIX}%` });
      // audit_log has no FK: delete exactly the rows about this suite's own tickets, so
      // a parallel suite acting as the same seeded user keeps its rows.
      await fleetPool.query(
        `DELETE FROM bms.audit_log
          WHERE entity_type = 'work_order'
            AND entity_id IN (
              SELECT w.id FROM bms.work_orders w
                JOIN bms.assets a ON a.id = w.asset_id
               WHERE a.code LIKE $1
            )`,
        [`${PREFIX}%`],
      );
      await fleetPool.query(
        `DELETE FROM bms.work_orders WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${PREFIX}%`],
      );
      await fleetPool.query(
        `DELETE FROM bms.alarms WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${PREFIX}%`],
      );
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      if (fixtureUserId) {
        // The fleet role cannot delete a user; the events that named it are gone above.
        await deleteFixtureUsers(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), {
          userId: fixtureUserId,
        });
      }
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("writes created, and assigned when the ticket starts with an assignee", async () => {
    await assertCreateWritesItsFirstEvents(ctx);
  });

  it("writes an event for a status move and an assignee change, and none for a position-only write", async () => {
    await assertStatusAndAssigneeChangesWriteEvents(ctx);
  });

  it("writes one event per ticket whose status a reorder changed", async () => {
    await assertReorderWritesOneEventPerStatusChange(ctx);
  });

  it("leaves no change and no event when the audit write fails", async () => {
    await assertAFailedAuditLeavesNoChangeAndNoEvent(ctx);
  });

  it("refuses UPDATE and DELETE on both pools with 42501", async () => {
    await assertTheTimelineIsAppendOnlyOnBothPools(ctx);
  });

  it("refuses an event filed under another organization's setting", async () => {
    await assertAForeignSettingCannotFileAnEvent(ctx);
  });

  it("saves the display name for a user, a global admin and a copilot change, never an email or a subject", async () => {
    await assertTheSavedNameIsTheDisplayName(ctx);
  });

  it("keeps the saved name when the user is renamed", async () => {
    await assertARenameDoesNotRewriteHistory(ctx);
  });

  it("writes no event for the same assignee re-sent", async () => {
    await assertASameAssigneeReSentWritesNoEvent(ctx);
  });

  it("puts the reference and both statuses in the status audit row", async () => {
    await assertTheAuditPayloadNamesTheTicket(ctx);
  });

  it("answers the detail in order, names a global admin to a tenant reader, and 404s outside the scope", async () => {
    await assertTheDetailReadIsScopedAndOrdered(ctx);
  });
});
