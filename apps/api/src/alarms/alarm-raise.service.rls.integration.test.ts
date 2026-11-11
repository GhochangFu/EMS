import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, automationRules, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { AlarmRaiser } from "./alarm-raise.service";
import type { AlarmRaiseRule } from "./alarm-raise.service";
import {
  assertRaiseDeviceHostAlarmOncePerOrganization,
  assertRaiseDeviceRaisesOnceAndNotifies,
  assertRaiseDeviceRefusesForeignRtu,
  assertRaiseRefusesCrossOrgUnderRealRls,
  assertRaiseStampsBothOrgsUnderRealRls,
  type AlarmRaiseRlsFixtures,
  type DeviceRaiseRlsFixtures,
} from "./alarm-raise.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds two asset + rule
 * pairs in one org, then drives `AlarmRaiser` with a real `bms_tenant`
 * connection: one raise that must stamp both org columns, and one whose rule
 * carries a foreign org and must be refused before anything is written.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "AlarmRaiser org stamping and relocation guard against real, non-owner roles",
  because:
    "AlarmRaiser is the one writer of bms.alarms and the streaming writer of bms.rule_executions, " +
    "both of which gain organization_id (0046) and a FORCEd policy (0047). Constructing it with a " +
    "real bms_tenant connection is the only proof it stamps alarms.org from the asset and " +
    "rule_executions.org from the rule under withTenant, and refuses to file an alarm into the " +
    "wrong tenant when the two diverge — rather than passing because the owner connection bypasses RLS.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
/** A uuid that is deliberately not any seeded organization, for the guard path. */
const FOREIGN_ORG = "00000000-0000-4000-8000-0000000000fe";

const RUN = Date.now();
const PREFIX = "E71B-AR-";

describe.skipIf(!connectionString)("E7.1b — AlarmRaiser stamps org under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AlarmRaiseRlsFixtures;
  let device: DeviceRaiseRlsFixtures;
  const startedAt = new Date(Date.now() - 60_000);
  const ruleIds: string[] = [];
  const assetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s org has no active location — run pnpm db:seed.`);
    }
    const locationId = loc.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    // Seed on the fleet (BYPASSRLS) connection: assets and automation_rules are
    // not policied until 0047, so no GUC is needed to insert them. The raiser
    // under test is the one that must run under a real bms_tenant connection.
    const fleetDb = createDb(ownerPool);

    async function seedPair(
      suffix: string,
    ): Promise<{ assetId: string; rule: { id: string; code: string; pointKey: string } }> {
      const pointKey = `e71b_ar_${suffix}`;
      const [asset] = await fleetDb
        .insert(assets)
        .values({
          organizationId,
          code: `${PREFIX}${suffix.toUpperCase()}-${RUN}`,
          name: `E7.1b AR Asset ${suffix}`,
          siteName: "E7.1b Site",
          locationId,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      const [rule] = await fleetDb
        .insert(automationRules)
        .values({
          code: `${PREFIX}RULE-${suffix.toUpperCase()}-${RUN}`,
          name: `E7.1b AR Rule ${suffix}`,
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
      assetIds.push(asset.id);
      ruleIds.push(rule.id);
      return { assetId: asset.id, rule: { id: rule.id, code: rule.code, pointKey } };
    }

    const stamp = await seedPair("stamp");
    const guard = await seedPair("guard");

    const ruleObject = (
      rule: { id: string; code: string; pointKey: string },
      ruleOrg: string | null,
    ): AlarmRaiseRule => ({
      id: rule.id,
      code: rule.code,
      name: `E7.1b AR ${rule.code}`,
      pointKey: rule.pointKey,
      severity: "warning",
      organizationId: ruleOrg,
      alarmMessage: null,
      unit: null,
    });

    ctx = {
      raiser: new AlarmRaiser(createDb(tenantPool)),
      ownerPool,
      organizationId,
      stampAssetId: stamp.assetId,
      stampRule: ruleObject(stamp.rule, organizationId),
      guardAssetId: guard.assetId,
      // The guard rule carries a foreign org — the asset relocated out from
      // under it — so the raise must be refused.
      guardRule: ruleObject(guard.rule, FOREIGN_ORG),
    };

    // F3.16: an RTU of this organization with no open device alarm, and one of another.
    const rtu = await ownerPool.query<{ id: string }>(
      `SELECT r.id FROM bms.rtus r
        WHERE r.organization_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms.alarms a WHERE a.rtu_id = r.id AND a.cleared_at IS NULL)
        ORDER BY r.created_at, r.id LIMIT 1`,
      [organizationId],
    );
    const foreignRtu = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.rtus WHERE organization_id <> $1 ORDER BY created_at, id LIMIT 1",
      [organizationId],
    );
    if (!rtu.rows[0] || !foreignRtu.rows[0]) {
      throw new Error("F3.16: needs a seeded RTU in two organizations — run pnpm db:seed.");
    }
    // An earlier run's open host alarm would dedupe this run's first raise.
    await ownerPool.query(
      "UPDATE bms.alarms SET cleared_at = now() WHERE organization_id = $1 AND source = 'ingest_host' AND cleared_at IS NULL",
      [organizationId],
    );
    device = {
      raiser: ctx.raiser,
      ownerPool,
      organizationId,
      rtuId: rtu.rows[0].id,
      foreignRtuId: foreignRtu.rows[0].id,
    };
  });

  afterAll(async () => {
    if (ownerPool) {
      await ownerPool.query(`DELETE FROM bms.rule_executions WHERE rule_id = ANY($1)`, [ruleIds]);
      await ownerPool.query(`DELETE FROM bms.alarms WHERE asset_id = ANY($1)`, [assetIds]);
      await ownerPool.query(
        "DELETE FROM bms.alarms WHERE source <> 'rule' AND organization_id = $1 AND raised_at >= $2",
        [ctx?.organizationId, startedAt],
      );
      await ownerPool.query(`DELETE FROM bms.automation_rules WHERE id = ANY($1)`, [ruleIds]);
      await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [assetIds]);
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("stamps alarms.org from the asset and rule_executions.org from the rule", async () => {
    await assertRaiseStampsBothOrgsUnderRealRls(ctx);
  });

  it("refuses a raise whose rule belongs to a different org than the asset", async () => {
    await assertRaiseRefusesCrossOrgUnderRealRls(ctx);
  });

  it("F3.16: raiseDevice raises one rtu_comms alarm, announces it, writes no trace, and dedupes", async () => {
    await assertRaiseDeviceRaisesOnceAndNotifies(device);
  });

  it("F3.16: raiseDevice raises one ingest_host alarm per organization", async () => {
    await assertRaiseDeviceHostAlarmOncePerOrganization(device);
  });

  it("F3.16: raiseDevice refuses an RTU of another organization, writing and announcing nothing", async () => {
    await assertRaiseDeviceRefusesForeignRtu(device);
  });
});
