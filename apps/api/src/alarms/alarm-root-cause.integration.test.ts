import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { automationRules, createDb } from "@bms/db";

import { seededRuleValues, type TemplateAlarm } from "../admin/asset-templates/template-alarm-rules";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { AlarmDetailsService } from "./alarm-details.service";
import {
  assertADeviceAlarmReadsNoEvidence,
  assertAnomaliesHaveZeroWeight,
  assertBoundariesThroughTheReads,
  assertBTenantSeesNothingOfA,
  assertEveryAnswerParses,
  assertR3KeepsItsOwnCap,
  assertTheRelatedAlarmsKeepTheCallersScope,
  assertTheFleetReadsKeepBothPoisonRowsOut,
  assertTheNotFoundIsDetails,
  assertThePlansScanAlarmsOnceAndProbeThePkey,
  assertThePolicyBindsWithoutThePredicate,
  assertTheTenantRoleHoldsTheGrants,
  assertS1MaintenanceCommsAndLinked,
  assertS2RecordedBeforeAndClassCause,
  assertS3HasNothing,
  assertS4RtulessLinksByLocationOnly,
  MIN,
  type OrgFixture,
  type RootCauseFixtures,
} from "./alarm-root-cause.integration.spec";
import { AlarmRootCauseService } from "./alarm-root-cause.service";

/**
 * `E2.3` / ADR 0136 (plan §6 T1.7) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle. The service
 * reads its evidence on `bms_tenant` and its gate (`AlarmDetailsService`) on
 * `bms_fleet`; access control resolves on `bms_auth`.
 *
 * **Two organizations of the suite's own**, with the same shapes at the same
 * minutes, so no seeded alarm, window or location is ever "near" a subject, and
 * the two-tenant proof does not depend on what the seed holds. Fixtures are
 * written on the superuser connection and removed by the organization ids this
 * run created, children first; every code carries the run's `e23-<stamp>`.
 * **All data is synthetic** (the repository is public). Every fixture window and
 * alarm lies days in the past and every alarm is cleared, so no concurrent raise,
 * sweep or cover read treats one as active. Times carry a microsecond fraction
 * on purpose: `T` must survive the trip through epoch milliseconds exactly (R-f).
 */
const connectionString = requireIntegrationDb({
  item: "E2.3",
  label: "the root-cause suggestion reads (two tenants, the 404, anomaly zero weight, the boundaries, EXPLAIN)",
  because:
    "the hand-written organization predicates on the fleet pool, the row level security on bms_tenant, the " +
    "time windows at their exact boundaries, the 404 shared with /details and the zero weight of anomaly " +
    "scores are all SQL over real rows; a green run without a database asserts none of them.",
});

const DAY = 24 * 60 * MIN;
const MICROS = "456";
/** An ISO instant with a fixed microsecond fraction, so offsets stay exact and `T` is not a whole millisecond. */
const ts = (ms: number): string => new Date(ms).toISOString().replace("Z", `${MICROS}Z`);

type Q = { query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> };

async function one(db: Q, text: string, values: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(text, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`E2.3: no row returned by ${text.slice(0, 60)}`);
  return id;
}

describe.skipIf(!connectionString)("E2.3 — root-cause suggestions against a real database", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: RootCauseFixtures;
  const stamp = randomUUID().slice(0, 8);
  const organizationIds: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E2.3");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E2.3",
    );
    tenant = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E2.3",
    );
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E2.3");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const superuserDb = createDb(superuser);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);

    const { rows: dom } = await superuser.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1");
    const domain = dom[0]?.code;
    if (!domain) throw new Error("E2.3: bms.asset_domains is empty — run pnpm db:seed.");
    const userId = await one(superuser, "SELECT id FROM bms.users ORDER BY created_at, id LIMIT 1", []);

    const t1 = Math.floor(Date.now() / MIN) * MIN - 3 * DAY;
    const t2 = t1 - 2 * DAY;
    const t3 = t1 - DAY;
    const t4 = t1 - 12 * 60 * MIN;
    const t5 = t1 - 6 * 60 * MIN;

    const buildOrg = async (tag: "A" | "B"): Promise<OrgFixture> => {
      const code = `e23-${stamp}-${tag}`;
      const text = (s: string): string => `E23-${tag} ${s}`;
      const organizationId = await one(
        superuser,
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [code.toUpperCase(), `E2.3 synthetic ${tag} ${stamp}`],
      );
      organizationIds.push(organizationId);
      const location = (suffix: string, parentId: string | null): Promise<string> =>
        one(
          superuser,
          `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
           VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5, true) RETURNING id`,
          [organizationId, `${code}-${suffix}`, `${code}-${suffix}`.toLowerCase(), text(`location ${suffix}`), parentId],
        );
      const site = await location("site", null);
      const building = await location("bldg", site);
      const locations = {
        site,
        building,
        room: await location("room", building),
        roomB: await location("roomb", building),
        roomC: await location("roomc", building),
        roomD: await location("roomd", building),
        roomE: await location("roome", building),
      };
      const rtuName = text("RTU");
      const rtuId = await one(
        superuser,
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
         VALUES ($1, $2, $3, $4, 'mqtt') RETURNING id`,
        [organizationId, locations.room, `${code}-rtu`, rtuName],
      );
      const asset = (suffix: string, locationId: string, wiredTo: string | null): Promise<string> =>
        one(
          superuser,
          `INSERT INTO bms.assets (organization_id, location_id, rtu_id, code, name, site_name, domain)
           VALUES ($1, $2, $3, $4, $5, 'E2.3 synthetic site', $6) RETURNING id`,
          [organizationId, locationId, wiredTo, `${code}-${suffix}`, text(`asset ${suffix}`), domain],
        );
      const assets = {
        a1: await asset("a1", locations.room, rtuId),
        a2: await asset("a2", locations.room, rtuId),
        a3: await asset("a3", locations.roomB, null),
        a4: await asset("a4", locations.roomC, null),
        a5: await asset("a5", locations.roomD, null),
        a6: await asset("a6", locations.roomB, null),
        a7: await asset("a7", locations.roomE, null),
        // S5's location-only neighbour: a1 and a2's room, no RTU.
        a8: await asset("a8", locations.room, null),
      };
      const plainRule = (suffix: string, assetId: string): Promise<string> =>
        one(
          superuser,
          `INSERT INTO bms.automation_rules
             (organization_id, code, name, category, rule_type, asset_id, point_key, operator, threshold_value, severity, enabled)
           VALUES ($1, $2, $2, 'safety', 'threshold', $3, 'e23_synthetic_point', 'gte', 999999, 'warning', false) RETURNING id`,
          [organizationId, `${code}-${suffix}`, assetId],
        );
      // R5's source: a published template whose alarm entry carries a cause, and a rule
      // built by `seededRuleValues`, the production function, as the E2.2 suite does.
      const classCause = text("synthetic class cause: lubrication starved");
      const templateName = text("synthetic template");
      const alarmEntry = {
        code: "E23_HIGH",
        pointKey: "e23_synthetic_point",
        message: "Synthetic temperature high",
        severity: "warning",
        category: "safety",
        philosophy: { cause: classCause },
      } as unknown as TemplateAlarm;
      const templateId = await one(
        superuser,
        `INSERT INTO bms.asset_templates (organization_id, code, version, name, asset_type, domain, status, content)
         VALUES ($1, $2, 1, $3, 'e23_synthetic_machine', $4, 'published', $5::jsonb) RETURNING id`,
        [organizationId, `${code}-tpl`, templateName, domain, JSON.stringify({ alarms: [alarmEntry] })],
      );
      const [seeded] = await superuserDb
        .insert(automationRules)
        .values(
          seededRuleValues({
            alarm: alarmEntry,
            assetId: assets.a5,
            assetCode: `${code}-a5`,
            organizationId,
            template: { id: templateId, version: 1 },
            unit: null,
            now: new Date(),
          }),
        )
        .returning({ id: automationRules.id });
      if (!seeded) throw new Error("E2.3: the seeded rule was not inserted");
      const rules = {
        s1: await plainRule("r-s1", assets.a1),
        other: await plainRule("r-other", assets.a1),
        s2: seeded.id,
        s5: await plainRule("r-s5", assets.a2),
      };

      const window = async (opts: {
        startsMs: number;
        endsMs: number;
        endedMs?: number;
        target: ["asset_id" | "location_id" | "rule_id", string];
      }): Promise<string> => {
        const id = await one(
          superuser,
          `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by, ended_at, ended_by)
           VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6::timestamptz, CASE WHEN $6::timestamptz IS NULL THEN NULL ELSE $5::uuid END)
           RETURNING id`,
          [organizationId, text("synthetic window"), ts(opts.startsMs), ts(opts.endsMs), userId, opts.endedMs === undefined ? null : ts(opts.endedMs)],
        );
        await superuser.query(
          `INSERT INTO bms.maintenance_window_targets (window_id, organization_id, ${opts.target[0]}) VALUES ($1, $2, $3)`,
          [id, organizationId, opts.target[1]],
        );
        return id;
      };
      const windows = {
        // In: ended early 20 min before T1 (asset target), and the parent location's window, open at T1.
        w1: await window({ startsMs: t1 - 120 * MIN, endsMs: t1 + 60 * MIN, endedMs: t1 - 20 * MIN, target: ["asset_id", assets.a1] }),
        w2: await window({ startsMs: t1 - 180 * MIN, endsMs: t1 + 120 * MIN, target: ["location_id", locations.building] }),
        // Out: rule-only (R-d); ended exactly 60 min before; 61 min before; starts after T1; a sibling location.
        w3: await window({ startsMs: t1 - 60 * MIN, endsMs: t1 + 60 * MIN, target: ["rule_id", rules.s1] }),
        w4: await window({ startsMs: t1 - 180 * MIN, endsMs: t1 - 60 * MIN, target: ["asset_id", assets.a1] }),
        w5: await window({ startsMs: t1 - 200 * MIN, endsMs: t1 - 61 * MIN, target: ["asset_id", assets.a1] }),
        w6: await window({ startsMs: t1 + MIN, endsMs: t1 + 60 * MIN, target: ["asset_id", assets.a1] }),
        w7: await window({ startsMs: t1 - 60 * MIN, endsMs: t1 + 60 * MIN, target: ["location_id", locations.roomB] }),
        // Out: planned for [T1 − 30 min, T1 + 60 min] on a1 and cancelled at T1 − 50 min, before it started
        // (`MaintenanceWindowsService.close(…, "cancel")` stamps `ended_at = now()` on a future window).
        w8: await window({ startsMs: t1 - 30 * MIN, endsMs: t1 + 60 * MIN, endedMs: t1 - 50 * MIN, target: ["asset_id", assets.a1] }),
      };

      const alarm = (opts: {
        message: string;
        raisedMs: number;
        assetId?: string;
        ruleId?: string;
        rtuId?: string;
        organizationId?: string;
      }): Promise<string> =>
        one(
          superuser,
          `INSERT INTO bms.alarms (organization_id, source, asset_id, rule_id, rtu_id, severity, message, raised_at, cleared_at)
           VALUES ($1, $2, $3, $4, $5, 'warning', $6, $7::timestamptz, $8::timestamptz) RETURNING id`,
          [
            opts.organizationId ?? organizationId,
            opts.rtuId === undefined ? "rule" : "rtu_comms",
            opts.assetId ?? null,
            opts.ruleId ?? null,
            opts.rtuId ?? null,
            opts.message,
            ts(opts.raisedMs),
            ts(opts.raisedMs + MIN),
          ],
        );
      const enrich = (alarmId: string, rootCause: string, enrichmentOrganizationId = organizationId): Promise<string> =>
        one(
          superuser,
          "INSERT INTO bms.alarm_enrichments (organization_id, alarm_id, root_cause) VALUES ($1, $2, $3) RETURNING id",
          [enrichmentOrganizationId, alarmId, rootCause],
        );

      const s1Alarms = {
        s1: await alarm({ message: text("subject S1"), raisedMs: t1, assetId: assets.a1, ruleId: rules.s1 }),
        c40: await alarm({ message: text("comms lost 40"), raisedMs: t1 - 40 * MIN, rtuId }),
        c60: await alarm({ message: text("comms lost 60"), raisedMs: t1 - 60 * MIN, rtuId }),
        c61: await alarm({ message: text("comms lost 61"), raisedMs: t1 - 61 * MIN, rtuId }),
        la2: await alarm({ message: text("neighbour on a2"), raisedMs: t1 - 10 * MIN, assetId: assets.a2 }),
        la1Other: await alarm({ message: text("a1 other rule"), raisedMs: t1 - 29 * MIN, assetId: assets.a1, ruleId: rules.other }),
        na3: await alarm({ message: text("a3 elsewhere"), raisedMs: t1 - 5 * MIN, assetId: assets.a3 }),
        na4: await alarm({ message: text("a4 elsewhere"), raisedMs: t1 - 15 * MIN, assetId: assets.a4 }),
        n31: await alarm({ message: text("a2 at 31"), raisedMs: t1 - 31 * MIN, assetId: assets.a2 }),
        b30: await alarm({ message: text("a2 at exactly 30"), raisedMs: t1 - 30 * MIN, assetId: assets.a2 }),
        b30s: await alarm({ message: text("a2 at 30 and a second"), raisedMs: t1 - 30 * MIN - 1000, assetId: assets.a2 }),
        same: await alarm({ message: text("a2 at the same instant"), raisedMs: t1, assetId: assets.a2 }),
        reraise: await alarm({ message: text("re-raise"), raisedMs: t1 - 15 * MIN, assetId: assets.a1, ruleId: rules.s1 }),
      };
      const past = async (days: number, rootCause: string): Promise<string> => {
        const id = await alarm({ message: text(`past ${days}`), raisedMs: t2 - days * DAY, assetId: assets.a5, ruleId: rules.s2 });
        await enrich(id, rootCause);
        return id;
      };
      const s2Alarms = {
        s2: await alarm({ message: text("subject S2"), raisedMs: t2, assetId: assets.a5, ruleId: rules.s2 }),
        p1: await past(1, ` ${text("Dry bearing")} `),
        p2: await past(2, text("dry BEARING").replace(`E23-${tag}`, `e23-${tag.toLowerCase()}`)),
        p179: await past(179, text("Dry bearing")),
        p3: await past(3, text("Loose coupling")),
        p181: await past(181, text("Old cause")),
        pSame: await past(0, text("Same instant cause")),
        pBlank: await past(5, "   "),
      };
      const s3 = await alarm({ message: text("subject S3"), raisedMs: t3, assetId: assets.a7 });
      const s4Alarms = {
        s4: await alarm({ message: text("subject S4"), raisedMs: t4, assetId: assets.a3 }),
        onA4: await alarm({ message: text("RTU-less elsewhere"), raisedMs: t4 - 5 * MIN, assetId: assets.a4 }),
        onA6: await alarm({ message: text("same room"), raisedMs: t4 - 5 * MIN, assetId: assets.a6 }),
      };
      // S5 on a2 (review finding 3): 20 re-raises of S5's rule and 21 location-only alarms on a8, all
      // newer than the one same-RTU alarm on a1 at 25 min. Neither population may take R3's 20 rows.
      const s5 = await alarm({ message: text("subject S5"), raisedMs: t5, assetId: assets.a2, ruleId: rules.s5 });
      const s5Rtu = await alarm({ message: text("S5 same RTU on a1"), raisedMs: t5 - 25 * MIN, assetId: assets.a1 });
      for (let k = 1; k <= 20; k += 1) {
        await alarm({ message: text(`S5 re-raise ${k}`), raisedMs: t5 - k * 30_000 - 15_000, assetId: assets.a2, ruleId: rules.s5 });
      }
      for (let k = 1; k <= 21; k += 1) {
        await alarm({ message: text(`S5 room neighbour ${k}`), raisedMs: t5 - k * 30_000, assetId: assets.a8 });
      }
      return {
        tag,
        organizationId,
        locations,
        rtuId,
        rtuName,
        assets,
        rules,
        windows,
        alarms: { ...s1Alarms, ...s2Alarms, s3, ...s4Alarms, s5, s5Rtu },
        classCause,
        templateName,
        texts: { dryBearing: text("Dry bearing"), looseCoupling: text("Loose coupling") },
      };
    };

    const a = await buildOrg("A");
    const b = await buildOrg("B");
    // The two mismatched rows the schema permits (plan §2.1): an alarm stamped B on A's asset,
    // 5 min before S1, and an enrichment stamped B on an earlier A alarm of S2's rule.
    const poisonAlarm = await one(
      superuser,
      `INSERT INTO bms.alarms (organization_id, source, asset_id, severity, message, raised_at, cleared_at)
       VALUES ($1, 'rule', $2, 'warning', 'POISON-ALARM', $3::timestamptz, $4::timestamptz) RETURNING id`,
      [b.organizationId, a.assets.a1, ts(t1 - 5 * MIN), ts(t1 - 4 * MIN)],
    );
    const poisonCauseAlarm = await one(
      superuser,
      `INSERT INTO bms.alarms (organization_id, source, asset_id, rule_id, severity, message, raised_at, cleared_at)
       VALUES ($1, 'rule', $2, $3, 'warning', $4, $5::timestamptz, $6::timestamptz) RETURNING id`,
      [a.organizationId, a.assets.a5, a.rules.s2, "E23-A past 4", ts(t2 - 4 * DAY), ts(t2 - 4 * DAY + MIN)],
    );
    await superuser.query(
      "INSERT INTO bms.alarm_enrichments (organization_id, alarm_id, root_cause) VALUES ($1, $2, 'POISON-CAUSE')",
      [b.organizationId, poisonCauseAlarm],
    );

    /** One succeeded `bms-anomaly` run and its rows, written as `bms_fleet` (the scorer's role). */
    const plantAnomalies = async (opts: {
      organizationId: string;
      assetId: string;
      startedMs: number;
      scores: ReadonlyArray<readonly [number, "baseline_mad" | "isolation_forest", number, readonly string[]]>;
    }): Promise<string> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status, error_text)
         VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000),
                 $5, 'succeeded', NULL)`,
        [id, opts.organizationId, "e".repeat(64), opts.startedMs, opts.scores.length],
      );
      runIds.push(id);
      for (const [bucketMs, detector, score, points] of opts.scores) {
        await fleet.query(
          `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
           VALUES ($1, $2, to_timestamp($3::float8 / 1000), $4, $5, $6::varchar(128)[], $7)`,
          [opts.organizationId, opts.assetId, bucketMs, detector, score, [...points], id],
        );
      }
      return id;
    };

    const details = new AlarmDetailsService(fleetDb);
    ctx = {
      svc: new AlarmRootCauseService(details, tenantDb),
      details,
      fleetDb,
      tenantDb,
      superuserDb,
      a,
      b,
      poison: { alarmId: poisonAlarm, causeAlarmId: poisonCauseAlarm },
      t1Ms: t1 + Number(MICROS) / 1000,
      t2Ms: t2 + Number(MICROS) / 1000,
      now: new Date(),
      readable: { locationAdmin: await accessControl.readableAssetIds(jwtFor(SEEDED.locationAdmin, "location_admin")) },
      plantAnomalies,
    };
  }, 180_000);

  afterAll(async () => {
    if (superuser) {
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      const orgs = [organizationIds];
      await superuser.query("DELETE FROM bms.notification_deliveries WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.rule_executions WHERE organization_id = ANY($1::uuid[])", orgs);
      // Enrichments cascade with their alarm; the POISON alarm is B's, so both orgs go together.
      await superuser.query("DELETE FROM bms.alarms WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.alarm_enrichments WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.maintenance_windows WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.automation_rules WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.asset_templates WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])", orgs);
      await superuser.query("DELETE FROM bms.rtus WHERE organization_id = ANY($1::uuid[])", orgs);
      for (let depth = 0; depth < 3; depth += 1) {
        await superuser.query(
          `DELETE FROM bms.locations l WHERE l.organization_id = ANY($1::uuid[])
              AND NOT EXISTS (SELECT 1 FROM bms.locations c WHERE c.parent_id = l.id)`,
          orgs,
        );
      }
      await superuser.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", orgs);
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 60_000);

  it("bms_tenant holds SELECT on every table the evidence reads (the plan's stop rule)", async () => {
    await assertTheTenantRoleHoldsTheGrants(ctx);
  });

  it("S1: exactly [maintenance strong, rtu_comms strong, linked_alarm moderate], with the right evidence", async () => {
    await assertS1MaintenanceCommsAndLinked(ctx);
  });

  it("boundaries through the reads: 30 min in, 30 min + 1 s out, 60 min for R1 and R2, 179/181 days, T itself", async () => {
    await assertBoundariesThroughTheReads(ctx);
  });

  it("S2: [recorded_before moderate, recorded_before weak, class_cause weak]; the quote is the newest row's", async () => {
    await assertS2RecordedBeforeAndClassCause(ctx);
  });

  it("S3: nothing at all gives the empty lists", async () => {
    await assertS3HasNothing(ctx);
  });

  it("S4: an RTU-less subject links by location only, never to another RTU-less asset elsewhere", async () => {
    await assertS4RtulessLinksByLocationOnly(ctx);
  });

  it("two tenants: the fleet-pool reads leave both POISON rows out (the hand-written predicates)", async () => {
    await assertTheFleetReadsKeepBothPoisonRowsOut(ctx);
  });

  it("two tenants: on bms_tenant the policy binds even when the predicate names the other organization", async () => {
    await assertThePolicyBindsWithoutThePredicate(ctx);
  });

  it("two tenants: no answer for A holds anything of B or a POISON row, and B's holds nothing of A", async () => {
    await assertBTenantSeesNothingOfA(ctx);
  });

  it("the 404: [b1], [] and the location admin's real scope give /details' own NotFoundException", async () => {
    await assertTheNotFoundIsDetails(ctx);
  });

  it("a device alarm answers the empty lists and reads no evidence", async () => {
    await assertADeviceAlarmReadsNoEvidence(ctx);
  });

  it("decision 3: anomaly rows change no candidate; only the newest run at or above the line gives context", async () => {
    await assertAnomaliesHaveZeroWeight(ctx);
  }, 60_000);

  it("every answer parses under the contract", async () => {
    await assertEveryAnswerParses(ctx);
  });

  it("a scoped caller: R3/R3b leave out the same-RTU and same-location alarms outside its asset ids", async () => {
    await assertTheRelatedAlarmsKeepTheCallersScope(ctx);
  });

  it("R3 keeps its own 20-row cap: 20 re-raises and 21 location-only alarms do not push out the same-RTU one", async () => {
    await assertR3KeepsItsOwnCap(ctx);
  });

  it("EXPLAIN: R4 probes alarms by key, never a Seq Scan; R2 + R3 scans bms.alarms once", async () => {
    await assertThePlansScanAlarmsOnceAndProbeThePkey(ctx);
  }, 120_000);
});
