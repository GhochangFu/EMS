import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb, locations } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { deleteWorkOrderEvents } from "../testing/work-order-events-cleanup";
import {
  assertACloseThatSkipsResolvedNeedsTheFindingsToo,
  assertAFailedAuditLeavesNoFindings,
  assertAPlannedTicketResolvesWithoutFindings,
  assertAReorderBackToWorkClearsTheResolveStamps,
  assertAResolvedTicketGoesBackToInProgressOnly,
  assertARootCauseWriteOutsideTheScopeIsNotFound,
  assertAStatusWriteCannotBlankAResolvedTicketsFindings,
  assertAnAlarmTicketNeedsItsFindingsToResolve,
  assertAnUnchangedRootCauseWritesNothing,
  assertAnUnknownOrRetiredCauseCodeIsRefused,
  assertFindingsAreKeptWhileResolvedAndFrozenAtClosed,
  assertFindingsSavedEarlierSatisfyTheGate,
  assertGoingBackToWorkClearsTheResolveStamps,
  assertResolveStampsAndWritesItsEvents,
  assertTheCauseCodeListIsTheActiveVocabulary,
  assertTheListItemCarriesTheCauseCode,
  assertTheRootCauseRouteReplacesTheFindings,
  assertTheStatusAuditRowHoldsNoFindingText,
  assertTheStatusCheckIsTheSixValues,
  assertTheTenantRoleCannotWriteCauseCodes,
  type FindingsFixtures,
} from "./work-order-findings.integration.spec";
import { WorkOrderFindingsService } from "./work-order-findings.service";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decision 5) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order findings and the resolve gate against real, non-owner roles",
  because:
    "the findings' guarantees live in Postgres: the cause-code vocabulary is read-only for bms_tenant by " +
    "privilege, the status CHECK closes the vocabulary, and the resolve gate is only sound under a real " +
    "row lock inside a real transaction. Only real pool roles prove any of them.",
});

// Per-run fixture prefixes (F4.65): randomUUID() sits in each declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-FND-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
/** The cause codes this run adds to the platform vocabulary: lower case, as a code is written. */
const VOCABULARY_FAMILY = "e31f_";
const VOCABULARY_PREFIX = `${VOCABULARY_FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}_`;

/**
 * Deletes everything this suite made for the assets matching `like`, children first,
 * except the assets, locations and vocabulary rows themselves: the callers delete those
 * with the prefix written out, where the fixture-isolation invariant can read it.
 * `olderThanMinutes` bounds the stale sweep to rows no run still in flight could own.
 */
async function deleteFixtures(fleet: pg.Pool, superuserUrl: string, like: string, olderThanMinutes?: number): Promise<void> {
  const minutes = olderThanMinutes ?? 0;
  const ownAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`;
  const ownWorkOrders = `SELECT id FROM bms.work_orders WHERE asset_id IN (${ownAssets})`;
  const args = [like, minutes];
  // The timeline is append-only for the fleet role: its rows go through the superuser helper.
  await deleteWorkOrderEvents(superuserUrl, { assetCodeLike: like, olderThanMinutes: minutes });
  // audit_log has no FK: delete exactly the rows about this suite's own tickets.
  await fleet.query(`DELETE FROM bms.audit_log WHERE entity_type = 'work_order' AND entity_id IN (${ownWorkOrders})`, args);
  await fleet.query(`DELETE FROM bms.work_orders WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(`DELETE FROM bms.alarm_enrichments WHERE alarm_id IN (SELECT id FROM bms.alarms WHERE asset_id IN (${ownAssets}))`, args);
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
    await fleet.query(`DELETE FROM bms.work_order_cause_codes WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      `${VOCABULARY_FAMILY}%`,
    ]);
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — work-order findings and the resolve gate under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: FindingsFixtures;

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
    const user = await fleetPool.query<{ id: string }>("SELECT id FROM bms.users WHERE email = $1 LIMIT 1", [
      SEEDED.organizationAdmin,
    ]);
    const actorUserId = user.rows[0]?.id;
    if (!actorUserId) throw new Error(`E3.1: ${SEEDED.organizationAdmin} is not seeded — run pnpm db:seed.`);

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
      return { assetId: await asset("A1"), otherAssetId: await asset("A2") };
    });
    const alarm = async (orgId: string, assetId: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>(
        "INSERT INTO bms.alarms (organization_id, asset_id, severity, message) VALUES ($1, $2, $3, 'E3.1 fixture alarm') RETURNING id",
        [orgId, assetId, severity.rows[0]?.code],
      );
      if (!rows[0]) throw new Error("E3.1: the fixture alarm was not created");
      return rows[0].id;
    };
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const failingAudit = {
      write: async (): Promise<never> => {
        throw new Error("audit is down");
      },
      writeMany: async (): Promise<never> => {
        throw new Error("audit is down");
      },
    } as unknown as MasterDataAuditService;

    // Two codes of this run's own, so no test retires a seeded one under a parallel suite.
    const retiredCauseCode = `${VOCABULARY_PREFIX}retired`;
    const ownCauseCode = `${VOCABULARY_PREFIX}own`;
    await fleetPool.query(
      "INSERT INTO bms.work_order_cause_codes (code, label, sort_order, active) VALUES ($1, 'E3.1 retired', 900, false), ($2, 'E3.1 own', 901, true)",
      [retiredCauseCode, ownCauseCode],
    );

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, audit),
      findings: new WorkOrderFindingsService(fleetDb, tenantDb, audit),
      findingsWithFailingAudit: new WorkOrderFindingsService(fleetDb, tenantDb, failingAudit),
      tenantPool,
      fleetPool,
      actor,
      actorUserId,
      organizationId,
      ...ids,
      alarmId: await alarm(organizationId, ids.assetId),
      retiredCauseCode,
      ownCauseCode,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteFixtures(fleetPool, resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), `${PREFIX}%`);
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      // Last: the tickets and enrichments that named these codes are gone above.
      await fleetPool.query(`DELETE FROM bms.work_order_cause_codes WHERE code LIKE $1`, [`${VOCABULARY_PREFIX}%`]);
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  describe("the resolve gate (decision 5.2)", () => {
    it("refuses resolved on an alarm ticket until it has all three findings (409), and saves nothing on a refusal", async () => {
      await assertAnAlarmTicketNeedsItsFindingsToResolve(ctx);
    });

    it("stamps who and when on resolve, and writes root_cause_set then resolved with no typed text", async () => {
      await assertResolveStampsAndWritesItsEvents(ctx);
    });

    it("keeps the typed findings out of the status audit row", async () => {
      await assertTheStatusAuditRowHoldsNoFindingText(ctx);
    });

    it("accepts findings saved earlier through the root-cause route", async () => {
      await assertFindingsSavedEarlierSatisfyTheGate(ctx);
    });

    it("resolves a planned ticket with no findings", async () => {
      await assertAPlannedTicketResolvesWithoutFindings(ctx);
    });

    it("gates a close that skips resolved the same way", async () => {
      await assertACloseThatSkipsResolvedNeedsTheFindingsToo(ctx);
    });
  });

  describe("leaving resolved (ruling P3)", () => {
    it("clears both resolve stamps on the way back to in_progress and keeps the findings", async () => {
      await assertGoingBackToWorkClearsTheResolveStamps(ctx);
    });

    it("answers 409 for resolved to open or assigned, by status and by reorder", async () => {
      await assertAResolvedTicketGoesBackToInProgressOnly(ctx);
    });

    it("clears the resolve stamps on a drag back to In progress", async () => {
      await assertAReorderBackToWorkClearsTheResolveStamps(ctx);
    });
  });

  describe("PUT /work-orders/:id/root-cause", () => {
    it("replaces the findings, answers the detail, and writes an event and an audit row with no typed text", async () => {
      await assertTheRootCauseRouteReplacesTheFindings(ctx);
    });

    it("writes nothing for a write that changes nothing", async () => {
      await assertAnUnchangedRootCauseWritesNothing(ctx);
    });

    it("keeps a resolved alarm ticket's findings (409) and freezes them at closed (409)", async () => {
      await assertFindingsAreKeptWhileResolvedAndFrozenAtClosed(ctx);
    });

    it("holds the same keep rule on the status route: a blank finding cannot overwrite a resolved ticket's", async () => {
      await assertAStatusWriteCannotBlankAResolvedTicketsFindings(ctx);
    });

    it("answers 400 for an unknown or retired cause code, and lets a ticket keep a code retired later", async () => {
      await assertAnUnknownOrRetiredCauseCodeIsRefused(ctx);
    });

    it("answers 404 for a ticket outside the caller's asset scope", async () => {
      await assertARootCauseWriteOutsideTheScopeIsNotFound(ctx);
    });

    it("leaves no findings and no event when the audit write fails", async () => {
      await assertAFailedAuditLeavesNoFindings(ctx);
    });
  });

  describe("the vocabulary and the contracts", () => {
    it("lists the nine seeded cause codes in order and no retired one", async () => {
      await assertTheCauseCodeListIsTheActiveVocabulary(ctx);
    });

    it("lets the tenant role read cause codes and refuses each write with 42501", async () => {
      await assertTheTenantRoleCannotWriteCauseCodes(ctx);
    });

    it("closes the status column over the six values", async () => {
      await assertTheStatusCheckIsTheSixValues(ctx);
    });

    it("carries causeCode and approvedAt on the list item", async () => {
      await assertTheListItemCarriesTheCauseCode(ctx);
    });
  });
});
