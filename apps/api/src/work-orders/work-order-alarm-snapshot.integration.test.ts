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
  assertAForeignAlarmsEnrichmentIsNeverCopied,
  assertALaterEnrichmentEditDoesNotReachTheTicket,
  assertARetiredSkillCodeIsStillCopied,
  assertATicketFromAnEnrichedAlarmCarriesTheFourValues,
  assertNoEnrichmentAndNoAlarmGiveANullSnapshot,
  assertNoWriteChangesTheSnapshot,
  assertTheSnapshotDoesNotSatisfyTheResolveGate,
  ENRICHMENT,
  type SnapshotFixtures,
} from "./work-order-alarm-snapshot.integration.spec";
import { WorkOrderFindingsService } from "./work-order-findings.service";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.4` in `E3.1` (ADR 0122 decision 5a) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "the alarm snapshot on a work order against real, non-owner roles",
  because:
    "the snapshot is copied inside the create's tenant transaction, where row security hides another " +
    "organization's alarm and its enrichment. Only a real bms_tenant connection proves that a foreign " +
    "enrichment cannot be copied, and only a real row proves a later edit does not reach the ticket.",
});

// Per-run fixture prefixes (F4.65): randomUUID() sits in each declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-SNP-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
/** The alarm skill this run adds to the platform vocabulary: lower case, as a code is written. */
const VOCABULARY_FAMILY = "e31s_";
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
    await fleet.query(`DELETE FROM bms.alarm_skills WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      `${VOCABULARY_FAMILY}%`,
    ]);
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.4 in E3.1 — the alarm snapshot on a work order under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: SnapshotFixtures;

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
      return { assetId: await asset("A1") };
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
    // An alarm skill of this run's own, retired after an enrichment names it.
    const retiredSkillCode = `${VOCABULARY_PREFIX}skill`;
    await fleetPool.query("INSERT INTO bms.alarm_skills (code, label, sort_order, active) VALUES ($1, 'E3.1 retired skill', 900, true)", [
      retiredSkillCode,
    ]);
    const enrich = async (orgId: string, alarmId: string, skillCode: string): Promise<void> => {
      await fleetPool.query(
        `INSERT INTO bms.alarm_enrichments (organization_id, alarm_id, root_cause, corrective_actions, skill_code, etr_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, alarmId, ENRICHMENT.rootCause, ENRICHMENT.correctiveActions, skillCode, ENRICHMENT.etrAt],
      );
    };
    const enrichedAlarmId = await alarm(organizationId, ids.assetId);
    await enrich(organizationId, enrichedAlarmId, ENRICHMENT.skillCode);
    const bareAlarmId = await alarm(organizationId, ids.assetId);
    const retiredSkillAlarmId = await alarm(organizationId, ids.assetId);
    await enrich(organizationId, retiredSkillAlarmId, retiredSkillCode);
    await fleetPool.query("UPDATE bms.alarm_skills SET active = false WHERE code = $1", [retiredSkillCode]);

    // An enriched alarm in another organization, on an asset of this run's own there.
    const other = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    if (!other.rows[0]) throw new Error("E3.1: need a second seeded organization — run pnpm db:seed.");
    const foreignOrgId = other.rows[0].id;
    const foreign = await withTenant(tenantDb, foreignOrgId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId: foreignOrgId,
          code: `${PREFIX}FLOC`,
          slug: `${PREFIX.toLowerCase()}floc`,
          name: "E3.1 foreign fixture location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const [row] = await tx
        .insert(assets)
        .values({
          organizationId: foreignOrgId,
          code: `${PREFIX}FA1`,
          name: "E3.1 foreign asset",
          siteName: "E3.1 Site",
          locationId: loc.id,
          domain: "electrical",
          active: true,
        })
        .returning({ id: assets.id });
      return row.id;
    });
    const foreignAlarmId = await alarm(foreignOrgId, foreign);
    await enrich(foreignOrgId, foreignAlarmId, ENRICHMENT.skillCode);

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, audit),
      findings: new WorkOrderFindingsService(fleetDb, tenantDb, audit),
      tenantDb,
      fleetPool,
      actor,
      organizationId,
      assetId: ids.assetId,
      enrichedAlarmId,
      bareAlarmId,
      retiredSkillAlarmId,
      retiredSkillCode,
      foreignAlarmId,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteFixtures(fleetPool, resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), `${PREFIX}%`);
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      // Last: the tickets and enrichments that named these codes are gone above.
      await fleetPool.query(`DELETE FROM bms.alarm_skills WHERE code LIKE $1`, [`${VOCABULARY_PREFIX}%`]);
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("copies the alarm's four values onto a ticket created from an enriched alarm", async () => {
    await assertATicketFromAnEnrichedAlarmCarriesTheFourValues(ctx);
  });

  it("leaves four NULLs for an alarm with no enrichment and for a ticket with no alarm", async () => {
    await assertNoEnrichmentAndNoAlarmGiveANullSnapshot(ctx);
  });

  it("does not move the ticket when the enrichment is edited afterwards", async () => {
    await assertALaterEnrichmentEditDoesNotReachTheTicket(ctx);
  });

  it("still copies a skill code that has been retired", async () => {
    await assertARetiredSkillCodeIsStillCopied(ctx);
  });

  it("never copies another organization's enrichment", async () => {
    await assertAForeignAlarmsEnrichmentIsNeverCopied(ctx);
  });

  it("does not let the snapshot satisfy the resolve gate", async () => {
    await assertTheSnapshotDoesNotSatisfyTheResolveGate(ctx);
  });

  it("changes the snapshot through no later write", async () => {
    await assertNoWriteChangesTheSnapshot(ctx);
  });
});
