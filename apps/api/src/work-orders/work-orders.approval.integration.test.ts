import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb, locations } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { withTenant } from "../database/tenant-context";
import { DashboardService } from "../dashboard/dashboard.service";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { SEEDED, jwtFor, jwtForUnprovisioned, primeSeededSubjects } from "../testing/seeded-subjects";
import { deleteWorkOrderEvents } from "../testing/work-order-events-cleanup";
import { WorkOrderApprovalService } from "./work-order-approval.service";
import { WorkOrderFindingsService } from "./work-order-findings.service";
import { WorkOrderTaskAddService } from "./work-order-task-add.service";
import {
  assertACancelledTicketReadsSlaNone,
  assertACancelledTicketRefusesEveryWrite,
  assertACancelledWorkOrderFreesItsSchedule,
  assertAClosedTicketRefusesApprovalRejectAndCancel,
  assertAFailedAuditLeavesNoApproval,
  assertASecondApproverIsNotSelfApproved,
  assertATicketWithNoRecordedResolverIsNeverSelfApproved,
  assertAnApprovalOutsideTheScopeIsNotFound,
  assertAnApproverWithNoUserRowIsRefused,
  assertCancelFromEachLiveStatusSkipsBothGates,
  assertCloseFromALiveStatusIs409AndWritesNothing,
  assertRejectOfAnUnresolvedTicketIs409,
  assertRejectSendsAResolvedTicketBackToWork,
  assertSelfApprovalIsAllowedAndRecorded,
  assertTheDetailNamesTheApprover,
  assertTheListReadsCancelledTickets,
  assertTheOpenCountsLeaveACancelledTicketOut,
  type ApprovalFixtures,
} from "./work-orders.approval.integration.spec";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decision 6) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order approval, reject and cancel against real, non-owner roles",
  because:
    "the approval's guarantees live in Postgres: a close is only sound when the status is read under a real " +
    "row lock, the change, its audit row and its timeline event are one real transaction, the six-value " +
    "status CHECK must accept `cancelled`, and a cancelled work order must stop counting as a schedule's " +
    "active one in a real query. Only real pool roles prove any of them.",
});

// Per-run fixture prefix (F4.65): randomUUID() sits in the declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-APR-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

/**
 * Deletes everything this suite made for the assets matching `like`, children first,
 * except the assets and locations themselves: the callers delete those with the prefix
 * written out, where the fixture-isolation invariant can read it. `olderThanMinutes`
 * bounds the stale sweep to rows no run still in flight could own.
 */
async function deleteFixtures(fleet: pg.Pool, superuserUrl: string, like: string, olderThanMinutes?: number): Promise<void> {
  const minutes = olderThanMinutes ?? 0;
  const ownAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`;
  const ownWorkOrders = `SELECT id FROM bms.work_orders WHERE asset_id IN (${ownAssets})`;
  const args = [like, minutes];
  // The timeline is append-only for the fleet role: its rows go through the superuser helper.
  await deleteWorkOrderEvents(superuserUrl, { assetCodeLike: like, olderThanMinutes: minutes });
  // audit_log has no FK: delete exactly the rows about this suite's own tickets and schedules.
  await fleet.query(
    `DELETE FROM bms.audit_log
      WHERE (entity_type = 'work_order' AND entity_id IN (${ownWorkOrders}))
         OR (entity_type = 'maintenance_schedule' AND entity_id IN (
               SELECT s.id FROM bms.maintenance_schedules s
                 JOIN bms.maintenance_task_templates m ON m.id = s.template_id
                WHERE m.asset_id IN (${ownAssets})))`,
    args,
  );
  await fleet.query(`DELETE FROM bms.work_order_tasks WHERE work_order_id IN (${ownWorkOrders})`, args);
  await fleet.query(`DELETE FROM bms.maintenance_history WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(`DELETE FROM bms.work_orders WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(
    `DELETE FROM bms.maintenance_schedules
      WHERE template_id IN (SELECT id FROM bms.maintenance_task_templates WHERE asset_id IN (${ownAssets}))`,
    args,
  );
  await fleet.query(`DELETE FROM bms.maintenance_task_templates WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(`DELETE FROM bms.alarms WHERE asset_id IN (${ownAssets})`, args);
}

/**
 * Reaps rows a *killed* earlier run of this suite committed but never cleaned. Every
 * statement is age-bounded, so a concurrent instance's rows (seconds old) are out of
 * reach. Non-fatal: per-run codes mean a leftover cannot collide with this run.
 */
async function sweepStaleRuns(fleet: pg.Pool, superuserUrl: string): Promise<void> {
  try {
    await deleteFixtures(fleet, superuserUrl, `${FAMILY}%`, 30);
    await fleet.query(`DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [`${FAMILY}%`]);
    await fleet.query(`DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      `${FAMILY}%`,
    ]);
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — work-order approval, reject and cancel under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: ApprovalFixtures;

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
    const secondApprover = jwtFor(SEEDED.globalAdmin, "admin");
    const userId = async (email: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>("SELECT id FROM bms.users WHERE email = $1 LIMIT 1", [email]);
      if (!rows[0]) throw new Error(`E3.1: ${email} is not seeded — run pnpm db:seed.`);
      return rows[0].id;
    };
    const actorUserId = await userId(SEEDED.organizationAdmin);
    const secondApproverUserId = await userId(SEEDED.globalAdmin);

    await sweepStaleRuns(fleetPool, resolveIntegrationRoleUrl(url, "superuser", process.env));

    // The organization admin's own organization. Every assertion here is about this
    // suite's own tickets, so sharing the organization with other suites is safe.
    const org = await fleetPool.query<{ id: string }>(
      "SELECT organization_id AS id FROM bms.user_organization_access WHERE user_id = $1 LIMIT 1",
      [actorUserId],
    );
    if (!org.rows[0]) throw new Error(`E3.1: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;
    const severity = await fleetPool.query<{ code: string }>("SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1");
    if (!severity.rows[0]) throw new Error("E3.1: alarm severities are not seeded — run pnpm db:seed.");

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const ids = await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: `${PREFIX}LOC`,
          slug: `${PREFIX.toLowerCase()}loc`,
          name: "E3.1 fixture location",
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
      return { assetId: await asset("A1"), otherAssetId: await asset("A2"), countAssetId: await asset("A3"), locationId: loc.id };
    });
    const alarm = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.alarms (organization_id, asset_id, severity, message) VALUES ($1, $2, $3, 'E3.1 fixture alarm') RETURNING id",
      [organizationId, ids.assetId, severity.rows[0].code],
    );
    if (!alarm.rows[0]) throw new Error("E3.1: the fixture alarm was not created");

    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const failingAudit = {
      write: async (): Promise<never> => {
        throw new Error("audit is down");
      },
      writeMany: async (): Promise<never> => {
        throw new Error("audit is down");
      },
    } as unknown as MasterDataAuditService;

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, audit),
      approval: new WorkOrderApprovalService(fleetDb, tenantDb, audit),
      approvalWithFailingAudit: new WorkOrderApprovalService(fleetDb, tenantDb, failingAudit),
      findings: new WorkOrderFindingsService(fleetDb, tenantDb, audit),
      taskAdd: new WorkOrderTaskAddService(fleetDb, tenantDb, audit),
      maintenance: new MaintenanceService(fleetDb, tenantDb, audit),
      // No tariff is read by the counts under test.
      dashboard: new DashboardService(fleetPool, { resolveForAssets: async () => new Map<string, number>() }),
      tenantPool,
      fleetPool,
      actor,
      actorUserId,
      secondApprover,
      secondApproverUserId,
      unknownApprover: jwtForUnprovisioned("e31-apr-nobody@integration.invalid", "admin"),
      organizationId,
      ...ids,
      alarmId: alarm.rows[0].id,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteFixtures(fleetPool, resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), `${PREFIX}%`);
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  describe("the approval — POST :id/close (decisions 6.2, 6.3 and 6.5)", () => {
    it("answers 409 for a ticket that is not resolved, and writes nothing", async () => {
      await assertCloseFromALiveStatusIs409AndWritesNothing(ctx);
    });

    it("lets the resolver approve their own ticket and records selfApproved on the event and the audit row", async () => {
      await assertSelfApprovalIsAllowedAndRecorded(ctx);
    });

    it("records no selfApproved for a second approver", async () => {
      await assertASecondApproverIsNotSelfApproved(ctx);
    });

    it("never marks self-approval on a ticket with no recorded resolver", async () => {
      await assertATicketWithNoRecordedResolverIsNeverSelfApproved(ctx);
    });

    it("names the approver in the detail read", async () => {
      await assertTheDetailNamesTheApprover(ctx);
    });
  });

  describe("the reject — POST :id/reject (decision 6.4)", () => {
    it("sends a resolved ticket back to in_progress, clears the resolve stamps and records the reason", async () => {
      await assertRejectSendsAResolvedTicketBackToWork(ctx);
    });

    it("answers 409 for a ticket that is not resolved", async () => {
      await assertRejectOfAnUnresolvedTicketIs409(ctx);
    });
  });

  describe("the cancel — POST :id/cancel (decision 6.8)", () => {
    it("cancels from each of the four live statuses, with a mandatory item pending and no root cause", async () => {
      await assertCancelFromEachLiveStatusSkipsBothGates(ctx);
    });

    it("reads SLA state none for a cancelled ticket", async () => {
      await assertACancelledTicketReadsSlaNone(ctx);
    });

    it("refuses every later write on a cancelled ticket", async () => {
      await assertACancelledTicketRefusesEveryWrite(ctx);
    });

    it("frees the schedule of a cancelled work order (D20)", async () => {
      await assertACancelledWorkOrderFreesItsSchedule(ctx);
    });

    it("lists cancelled tickets, and filters on the status", async () => {
      await assertTheListReadsCancelledTickets(ctx);
    });

    it("leaves a cancelled ticket out of the dashboard's and the metric catalog's open counts (D20)", async () => {
      await assertTheOpenCountsLeaveACancelledTicketOut(ctx);
    });
  });

  describe("all three", () => {
    it("refuse a closed ticket (400)", async () => {
      await assertAClosedTicketRefusesApprovalRejectAndCancel(ctx);
    });

    it("refuse a caller with no user row (403)", async () => {
      await assertAnApproverWithNoUserRowIsRefused(ctx);
    });

    it("answer 404 outside the caller's asset scope", async () => {
      await assertAnApprovalOutsideTheScopeIsNotFound(ctx);
    });

    it("leave nothing behind when the audit write fails", async () => {
      await assertAFailedAuditLeavesNoApproval(ctx);
    });
  });
});
