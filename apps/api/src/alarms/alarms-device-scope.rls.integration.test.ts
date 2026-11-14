import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AssetHealthService } from "../asset-health/asset-health.service";
import type { CalcParametersService } from "../calc/calc-parameters.service";
import { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import { DashboardService } from "../dashboard/dashboard.service";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";
import {
  assertAcknowledgeKeepsTheGateAndTheScope,
  assertCatalogAlarmTilesAgreeWithTheSummary,
  assertDashboardCountsAgree,
  assertDetailsFollowTheScope,
  assertEnrichmentRefusesADeviceAlarm,
  assertHostAlarmFollowsMonitoredRtus,
  assertOrganizationBNeverSeesA,
  assertRtuAlarmVisibleOnlyThroughAnAssetOnTheRtu,
  assertRuleOnlyListLeavesOutDeviceAlarms,
  assertSummaryAgreesWithTheList,
  type DeviceScopeFixtures,
} from "./alarms-device-scope.rls.integration.spec";

/**
 * `F3.16` (plan B5) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the pools and the committed fixtures,
 * swept by this run's code prefix in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F3.16",
  label: "device alarm visibility (ADR 0127 decision 14) under real RLS",
  because:
    "the device alarm scope rule is SQL over bms.assets and bms.rtu_health, run on the tenant pool for " +
    "one organization and on the fleet pool across organizations; a green run without a database " +
    "proves none of it.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run fixture prefix (F4.65): afterAll sweeps only this run's rows.
const PREFIX = `F316-DS-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

const gatewayStub = { broadcastAcknowledged: () => undefined } as unknown as AlarmsGateway;

describe.skipIf(!connectionString)("F3.16 — device alarm visibility follows the assets on the RTU", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: DeviceScopeFixtures;
  let user: JwtPayload;
  const alarmIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.16");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.16",
    );
    await primeSeededSubjects(fleetPool);
    user = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    const orgA = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id WHERE u.email = $1 LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    const orgAId = orgA.rows[0]?.id;
    if (!orgAId) throw new Error(`F3.16: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    const orgB = await fleetPool.query<{ id: string }>(
      `SELECT o.id FROM bms.organizations o
        WHERE o.id <> $1 AND EXISTS (SELECT 1 FROM bms.locations l WHERE l.organization_id = o.id AND l.active)
        ORDER BY o.created_at, o.code LIMIT 1`,
      [orgAId],
    );
    const orgBId = orgB.rows[0]?.id;
    if (!orgBId) throw new Error("F3.16: need a second seeded organization with an active location.");
    const domain = (await fleetPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active LIMIT 1"))
      .rows[0]?.code;
    const tone = async (t: string) =>
      (
        await fleetPool.query<{ code: string }>(
          "SELECT code FROM bms.alarm_severities WHERE active AND tone = $1 ORDER BY rank LIMIT 1",
          [t],
        )
      ).rows[0]?.code;
    const critical = await tone("critical");
    const warning = await tone("warning");
    if (!domain || !critical || !warning) throw new Error("F3.16: seed an asset domain and both severity tones.");

    const locationOf = async (orgId: string) =>
      (
        await fleetPool.query<{ id: string }>(
          "SELECT id FROM bms.locations WHERE organization_id = $1 AND active ORDER BY created_at, code LIMIT 1",
          [orgId],
        )
      ).rows[0]!.id;
    const locA = await locationOf(orgAId);
    const locB = await locationOf(orgBId);

    const rtu = async (orgId: string, locationId: string, code: string, monitored: boolean) => {
      const { rows } = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
         VALUES ($1, $2, $3, $3, 'mqtt', 10) RETURNING id`,
        [orgId, locationId, code],
      );
      const id = rows[0]!.id;
      if (monitored) {
        await fleetPool.query(
          `INSERT INTO bms.rtu_health (rtu_id, organization_id, monitored_since, last_seen_at)
           VALUES ($1, $2, now(), now())`,
          [id, orgId],
        );
      }
      return id;
    };
    const asset = async (orgId: string, locationId: string, code: string, rtuId: string | null) =>
      (
        await fleetPool.query<{ id: string }>(
          `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, active, rtu_id)
           VALUES ($1, $2, 'F3.16 device scope asset', 'F3.16 Site', $3, $4, true, $5) RETURNING id`,
          [orgId, code, locationId, domain, rtuId],
        )
      ).rows[0]!.id;
    const alarm = async (
      orgId: string,
      source: "rtu_comms" | "ingest_host",
      rtuId: string | null,
      severity: string,
      cleared: boolean,
    ) => {
      const { rows } = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.alarms (organization_id, source, rtu_id, severity, message, cleared_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END) RETURNING id`,
        [orgId, source, rtuId, severity, `${PREFIX}${source}`, cleared],
      );
      alarmIds.push(rows[0]!.id);
      return rows[0]!.id;
    };

    const a1Code = `${PREFIX}A1`;
    const a1 = await rtu(orgAId, locA, a1Code, true);
    const a2 = await rtu(orgAId, locA, `${PREFIX}A2`, false);
    const b1 = await rtu(orgBId, locB, `${PREFIX}B1`, true);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      svc: new AlarmsService(tenantDb, fleetDb, gatewayStub, audit),
      // `accessControl` is never reached: the suite drives `resolveBindings` with the readable set.
      catalog: new MetricCatalogService(
        tenantDb,
        fleetDb,
        undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
        new AssetHealthService(fleetDb),
        fleetPool,
      ),
      // No skill code is sent, so the vocabulary check is never reached.
      enrichment: new AlarmEnrichmentService(tenantDb, fleetDb, {} as VocabulariesService, audit),
      tenantDb,
      orgA: orgAId,
      warning,
      prefix: PREFIX,
      details: new AlarmDetailsService(fleetDb),
      dashboard: new DashboardService(fleetPool, {} as Pick<CalcParametersService, "resolveForAssets">, {
        scoresByLocation: async () => new Map<string, number | null>(),
      }),
      ownerPool: fleetPool,
      fleetDb,
      aOn1: await asset(orgAId, locA, `${PREFIX}aOn1`, a1),
      aOn2: await asset(orgAId, locA, `${PREFIX}aOn2`, a2),
      aOff: await asset(orgAId, locA, `${PREFIX}aOff`, null),
      bOn1: await asset(orgBId, locB, `${PREFIX}bOn1`, b1),
      a1Code,
      alarmA1: await alarm(orgAId, "rtu_comms", a1, critical, false),
      alarmA2: await alarm(orgAId, "rtu_comms", a2, warning, false),
      hostA: await alarm(orgAId, "ingest_host", null, critical, true),
      alarmB1: await alarm(orgBId, "rtu_comms", b1, warning, false),
      hostB: await alarm(orgBId, "ingest_host", null, critical, true),
    };
  }, 60_000);

  afterAll(async () => {
    if (fleetPool) {
      await fleetPool.query(
        `DELETE FROM bms.audit_log WHERE entity_type = 'alarm' AND entity_id = ANY($1::uuid[])`,
        [alarmIds],
      );
      await fleetPool.query("DELETE FROM bms.alarms WHERE id = ANY($1::uuid[])", [alarmIds]);
      await fleetPool.query("DELETE FROM bms.assets WHERE code LIKE $1", [`${PREFIX}%`]);
      await fleetPool.query(
        "DELETE FROM bms.rtu_health WHERE rtu_id IN (SELECT id FROM bms.rtus WHERE code LIKE $1)",
        [`${PREFIX}%`],
      );
      await fleetPool.query("DELETE FROM bms.rtus WHERE code LIKE $1", [`${PREFIX}%`]);
    }
    await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("an asset-group user sees an RTU's alarm only when an asset in its scope is on that RTU", async () => {
    await assertRtuAlarmVisibleOnlyThroughAnAssetOnTheRtu(ctx);
  });

  it("the host alarm is visible through an asset on a monitored RTU of its organization", async () => {
    await assertHostAlarmFollowsMonitoredRtus(ctx);
  });

  it("organization B never sees A's device alarms; the global admin sees all", async () => {
    await assertOrganizationBNeverSeesA(ctx);
  });

  it("the summary count equals the active list's length", async () => {
    await assertSummaryAgreesWithTheList(ctx);
  });

  it("the dashboard's alarmsOpen and alarmsCritical agree with the summary", async () => {
    await assertDashboardCountsAgree(ctx);
  });

  it("details read a device alarm in scope and 404 outside it", async () => {
    await assertDetailsFollowTheScope(ctx);
  });

  it("the catalog's alarm tiles and their prior count what the summary counts, device alarms included", async () => {
    await assertCatalogAlarmTilesAgreeWithTheSummary(ctx);
  });

  it("the enrichment write 404s a device alarm for every caller, the global admin included", async () => {
    await assertEnrichmentRefusesADeviceAlarm(ctx, user);
  });

  it("ruleOnly lists no device alarm", async () => {
    await assertRuleOnlyListLeavesOutDeviceAlarms(ctx);
  });

  it("acknowledging keeps the operations role gate and 404s outside scope", async () => {
    await assertAcknowledgeKeepsTheGateAndTheScope(ctx, user);
  });
});
