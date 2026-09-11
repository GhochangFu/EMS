import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, automationRules, createDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertBroadcastRowCarriesTheAssetJoin,
  assertBroadcastRowIsTheRaisedAlarm,
  assertCommittedRaiseIsBroadcastOnce,
  assertDedupedRaiseNotifiesNobody,
  assertListenerReadTheCommittedAlarm,
  assertMissingAlarmReadsAsNull,
  assertRolledBackRaiseDidRaiseInsideItsTransaction,
  assertRolledBackRaiseIsNeverRead,
  assertRolledBackRaiseIsNotBroadcast,
  assertSecondRaiseOfTheSameRuleIsDeduped,
  openListenerHarness,
  runCommittedRaise,
  runDedupedRaise,
  runMissingAlarmRead,
  runRolledBackRaise,
  type AlarmNotifyFixtures,
  type CommittedRaiseOutcome,
  type DedupedRaiseOutcome,
  type ListenerHarness,
  type RolledBackRaiseOutcome,
} from "./alarm-notify.integration.spec";
import type { AlarmRaiseRule } from "./alarm-raise.service";

/**
 * `F3.11` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: three pools (fleet for
 * seeding, reads and cleanup; `bms_tenant` for the raiser; `bms_auth` for the
 * `LISTEN` client, as `AlarmNotifyService` connects), one committed asset +
 * two rule fixtures prefixed `F311N_`, and an `afterAll` that deletes them by
 * id in FK order — `rule_executions` → `alarms` → `automation_rules` →
 * `assets` — then stops the listener and ends the pools.
 *
 * Committed, not rolled back, because a transactional `NOTIFY` is dropped
 * with a rollback and the positive row is the whole point. The rows run in
 * order against one listener; every count is a delta on the row's own
 * window.
 */
const connectionString = requireIntegrationDb({
  item: "F3.11",
  label: "alarm NOTIFY listener tests",
  because:
    "they are the only proof that AlarmRaiser's pg_notify('bms_alarms') reaches a LISTEN " +
    "client connected as bms_auth on a real database and comes back as the alarm row the " +
    "gateway broadcasts (ADR 0064 decision 4), and that a raise whose transaction rolls back " +
    "announces nothing. Fix the pipeline, do not relax this guard.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const PREFIX = "F311N_";
const ROW_TIMEOUT_MS = 15_000;

describe.skipIf(!connectionString)("F3.11 — NOTIFY bms_alarms reaches the listener", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let harness: ListenerHarness;
  let ctx: AlarmNotifyFixtures;
  const ruleIds: string[] = [];
  const assetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.11");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.11",
    );
    const authUrl = process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev");

    const org = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F3.11: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const loc = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(`F3.11: ${ORGANIZATION_ADMIN_EMAIL}'s org has no active location — run pnpm db:seed.`);
    }
    const dom = await fleetPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F3.11: no active asset_domain — run pnpm db:seed.");
    }

    // Seeded on the fleet (BYPASSRLS) pool; the raiser under test runs as
    // bms_tenant, the role both processes raise as.
    const fleetDb = createDb(fleetPool);
    const [asset] = await fleetDb
      .insert(assets)
      .values({
        organizationId,
        code: `${PREFIX}ASSET-${RUN}`,
        name: "F3.11 NOTIFY listener fixture asset",
        siteName: "F3.11 NOTIFY listener site",
        locationId: loc.rows[0].id,
        domain: dom.rows[0].code,
        active: true,
      })
      .returning({ id: assets.id });
    if (!asset) {
      throw new Error("F3.11: the fixture asset insert returned no row");
    }
    assetIds.push(asset.id);

    async function seedRule(suffix: string): Promise<AlarmRaiseRule> {
      const pointKey = `f311n_${suffix}`;
      const [rule] = await fleetDb
        .insert(automationRules)
        .values({
          code: `${PREFIX}RULE-${suffix.toUpperCase()}-${RUN}`,
          name: `F3.11 NOTIFY listener rule ${suffix}`,
          category: "safety",
          ruleType: "threshold",
          organizationId,
          assetId: asset.id,
          pointKey,
          operator: "gte",
          thresholdValue: 999_999,
          severity: "warning",
        })
        .returning({ id: automationRules.id, code: automationRules.code });
      if (!rule) {
        throw new Error(`F3.11: the fixture rule ${suffix} insert returned no row`);
      }
      ruleIds.push(rule.id);
      return {
        id: rule.id,
        code: rule.code,
        name: `F3.11 NOTIFY listener rule ${suffix}`,
        pointKey,
        severity: "warning",
        organizationId,
        alarmMessage: null,
        unit: null,
      };
    }

    const ruleA = await seedRule("committed");
    const ruleB = await seedRule("rolledback");

    harness = openListenerHarness({ authUrl, fleetDb });
    ctx = {
      harness,
      fleetDb,
      tenantDb: createDb(tenantPool),
      organizationId,
      assetId: asset.id,
      ruleA,
      ruleB,
    };
  }, ROW_TIMEOUT_MS);

  afterAll(async () => {
    if (harness !== undefined) {
      await harness.listener.stop();
    }
    if (fleetPool) {
      await fleetPool.query(`DELETE FROM bms.rule_executions WHERE rule_id = ANY($1)`, [ruleIds]);
      await fleetPool.query(`DELETE FROM bms.alarms WHERE asset_id = ANY($1)`, [assetIds]);
      await fleetPool.query(`DELETE FROM bms.automation_rules WHERE id = ANY($1)`, [ruleIds]);
      await fleetPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [assetIds]);
    }
    await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, ROW_TIMEOUT_MS);

  describe("a committed raise", () => {
    let outcome: CommittedRaiseOutcome;
    beforeAll(async () => {
      outcome = await runCommittedRaise(ctx);
    }, ROW_TIMEOUT_MS);

    it("is broadcast exactly once within 5 s", () => {
      assertCommittedRaiseIsBroadcastOnce(outcome);
    });

    it("broadcasts the raised alarm, carrying the rule code", () => {
      assertBroadcastRowIsTheRaisedAlarm(outcome);
    });

    it("broadcasts a row whose assetCode came through the join", () => {
      assertBroadcastRowCarriesTheAssetJoin(outcome);
    });

    it("was read by the listener by its id (the observable the negative row uses)", () => {
      assertListenerReadTheCommittedAlarm(outcome);
    });
  });

  describe("a raise whose transaction rolls back", () => {
    let outcome: RolledBackRaiseOutcome;
    beforeAll(async () => {
      outcome = await runRolledBackRaise(ctx);
    }, ROW_TIMEOUT_MS);

    it("did raise inside its transaction (positive control for the absence)", () => {
      assertRolledBackRaiseDidRaiseInsideItsTransaction(outcome);
    });

    it("is never read by the listener", () => {
      assertRolledBackRaiseIsNeverRead(outcome);
    });

    it("is not broadcast", () => {
      assertRolledBackRaiseIsNotBroadcast(outcome);
    });
  });

  describe("a second committed raise of the same rule", () => {
    let outcome: DedupedRaiseOutcome;
    beforeAll(async () => {
      outcome = await runDedupedRaise(ctx);
    }, ROW_TIMEOUT_MS);

    it("is deduped by the database", () => {
      assertSecondRaiseOfTheSameRuleIsDeduped(outcome);
    });

    it("notifies nobody", () => {
      assertDedupedRaiseNotifiesNobody(outcome);
    });
  });

  describe("readAlarmListItem of an unknown id", () => {
    let row: AlarmListItem | null;
    beforeAll(async () => {
      row = await runMissingAlarmRead(ctx);
    }, ROW_TIMEOUT_MS);

    it("answers null rather than throwing", () => {
      assertMissingAlarmReadsAsNull(row);
    });
  });
});
