import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, automationRules, createDb, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { AlarmsGateway } from "../alarms/alarms.gateway";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { pointKeysForAsset } from "./rule-points";
import { RulesService } from "./rules.service";
import {
  assertAssetlessTimeWindowRefusedForAdmin,
  assertAssetlessTimeWindowRefusedForScoped,
  assertCreateDraftReadsBackOnTenantTransaction,
  assertCreateStampsOrgAndActorUnderRealRls,
  assertPublishRuleReadsBackInTenantTransaction,
  assertRuleExecutionListReturnsBothOrgsForTwoOrgActor,
  assertRuleListReturnsBothOrgsForTwoOrgActor,
  assertSingleOrgRuleExecutionListReturnsOwnRow,
  assertSingleOrgRuleExecutionListRunsOnTenantTransaction,
  assertSingleOrgRuleListReturnsOwnRow,
  assertSingleOrgRuleListRunsOnTenantTransaction,
  assertUpdateRuleReadsBackInTenantTransaction,
  type RulesRlsFixtures,
} from "./rules.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one asset in a
 * real organization, then drives `RulesService.createDraft` with a real
 * `bms_tenant` connection: one threshold create that must stamp the rule's org
 * and resolve its actor, and two asset-less `time_window` creates that ruling 4
 * refuses (a global admin with no tenant, and a scoped actor 404'd before org
 * resolution).
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "RulesService.createDraft org stamping and ruling-4 refusal against real, non-owner roles",
  because:
    "createDraft is the rule-authoring write this unit tenant-wraps. automation_rules gains " +
    "organization_id (0046) and a FORCEd policy (0047). Constructing RulesService with a real " +
    "bms_tenant connection is the only proof it stamps automation_rules.org from the asset under " +
    "withTenant and lands a non-NULL audit actor from the pre-tenant fleetDb read — rather than " +
    "passing because the owner connection bypasses RLS — and that ruling 4 refuses an asset-less " +
    "time_window create instead of inserting a NULL org.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";

// Per-run fixture prefix (F4.65). afterAll cleans up automation_rules with
// `DELETE ... WHERE code LIKE` on the fleet (BYPASSRLS) pool the gate hands
// back, which sees every organization's rows — so a family-wide sweep would
// reap a concurrent instance's rules. randomUUID() sits in PREFIX's own
// declaration because the isolation invariant
// (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `E71B-RULE-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

function stubGateway(): AlarmsGateway {
  return { broadcastCreated: () => undefined } as unknown as AlarmsGateway;
}

describe.skipIf(!connectionString)("E7.1b — RulesService.createDraft under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: RulesRlsFixtures;
  const createdRuleIds: string[] = [];
  let assetId: string;
  let foreignAssetId = "";
  let decoyAssetId = "";

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
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
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

    // Seed on the fleet (BYPASSRLS) pool: assets are not policied until 0047, so
    // no GUC is needed to insert one. The createDraft under test is what must run
    // under a real bms_tenant connection.
    const fleetDb = createDb(ownerPool);
    const code = `${PREFIX}ASSET`;
    const [asset] = await fleetDb
      .insert(assets)
      .values({
        organizationId,
        code,
        name: `E7.1b rules RLS asset`,
        siteName: "E7.1b Site",
        locationId,
        domain,
        active: true,
      })
      .returning({ id: assets.id });
    assetId = asset.id;
    // A point compatible with the seeded (domain, code) — the fallback list is
    // never empty, so [0] always exists — so assertCompatiblePoint passes.
    const pointKey = pointKeysForAsset(domain, code)[0] as string;

    const tenantDb = createDb(tenantPool);

    // Seeds a disabled draft rule on an asset, under that org's GUC so the FORCE
    // WITH CHECK passes. Returns the rule id.
    const seedRule = async (orgId: string, aId: string, ruleCode: string): Promise<string> =>
      withTenant(tenantDb, orgId, async (tx) => {
        const [row] = await tx
          .insert(automationRules)
          .values({
            organizationId: orgId,
            code: ruleCode,
            name: `E7.1b read-path rule ${ruleCode}`,
            description: null,
            category: DEFAULT_RULE_CATEGORY_CODE,
            ruleType: "threshold",
            source: "operator_rule",
            enabled: false,
            assetId: aId,
            pointKey: "PWR",
            operator: "gt",
            thresholdValue: 1,
            severity: null,
            condition: { window: "latest" },
            action: { type: "trace_only", target: "Operations" },
            lifecycleStatus: "draft",
            publishedAt: null,
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: automationRules.id });
        createdRuleIds.push(row.id);
        return row.id;
      });

    // One execution per seeded rule, stamped its org under the org GUC, so
    // listExecutions has rows to return on both the single-org and fleet paths.
    const seedExecution = async (orgId: string, ruleId: string): Promise<string> =>
      withTenant(tenantDb, orgId, async (tx) => {
        const [row] = await tx
          .insert(ruleExecutions)
          .values({
            organizationId: orgId,
            ruleId,
            status: "matched",
            matched: true,
            observedValue: 1,
            message: "E7.1b read-path execution",
            trace: {},
          })
          .returning({ id: ruleExecutions.id });
        return row.id;
      });

    const inScopeRuleId = await seedRule(organizationId, assetId, `${PREFIX}READA`);
    const inScopeExecutionId = await seedExecution(organizationId, inScopeRuleId);

    // A second organization for the decision-3 two-org read. Reuse its seeded
    // active location; seed a foreign asset + rule under its GUC.
    const orgB = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [organizationId],
    );
    if (!orgB.rows[0]) {
      throw new Error("E7.1b: need a second seeded organization for the two-org read proof.");
    }
    const foreignOrgId = orgB.rows[0].id;
    const foreignLoc = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
      [foreignOrgId],
    );
    if (!foreignLoc.rows[0]) {
      throw new Error(`E7.1b: org ${foreignOrgId} has no active location — run pnpm db:seed.`);
    }
    const [foreignAsset] = await fleetDb
      .insert(assets)
      .values({
        organizationId: foreignOrgId,
        code: `${PREFIX}ASSETB`,
        name: "E7.1b rules RLS asset B",
        siteName: "E7.1b Site",
        locationId: foreignLoc.rows[0].id,
        domain,
        active: true,
      })
      .returning({ id: assets.id });
    foreignAssetId = foreignAsset.id;
    const foreignRuleId = await seedRule(foreignOrgId, foreignAssetId, `${PREFIX}READB`);
    const foreignExecutionId = await seedExecution(foreignOrgId, foreignRuleId);

    // Decoy: a rule + execution on a THIRD asset in org A that the reads never
    // pass, so the `assetIds` WHERE must exclude it. No seeded executions exist,
    // so without this the listExecutions exclusion would pass vacuously.
    const [decoyAsset] = await fleetDb
      .insert(assets)
      .values({
        organizationId,
        code: `${PREFIX}ASSETC`,
        name: "E7.1b rules RLS decoy asset",
        siteName: "E7.1b Site",
        locationId,
        domain,
        active: true,
      })
      .returning({ id: assets.id });
    decoyAssetId = decoyAsset.id;
    const decoyRuleId = await seedRule(organizationId, decoyAssetId, `${PREFIX}READC`);
    const decoyExecutionId = await seedExecution(organizationId, decoyRuleId);

    const makeService = (t: BmsDb, f: BmsDb): RulesService =>
      new RulesService(t, f, new VocabulariesService(f), new AlarmRaiser(t, stubGateway()));
    ctx = {
      service: makeService(tenantDb, fleetDb),
      tenantDb,
      fleetDb,
      makeService,
      ownerPool,
      organizationId,
      assetId,
      pointKey,
      scopedActor: {
        sub: "00000000-0000-4000-8000-0000000000a1",
        email: ORGANIZATION_ADMIN_EMAIL,
      },
      adminActor: {
        sub: "00000000-0000-4000-8000-0000000000a2",
        email: GLOBAL_ADMIN_EMAIL,
      },
      createdRuleIds,
      foreignAssetId,
      inScopeRuleId,
      foreignRuleId,
      inScopeExecutionId,
      foreignExecutionId,
      decoyExecutionId,
    };
  });

  afterAll(async () => {
    if (ownerPool) {
      if (createdRuleIds.length > 0) {
        // Executions FK into automation_rules — clear them before the rules.
        await ownerPool.query(`DELETE FROM bms.rule_executions WHERE rule_id = ANY($1)`, [
          createdRuleIds,
        ]);
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'automation_rule' AND entity_id = ANY($1)`,
          [createdRuleIds],
        );
        await ownerPool.query(`DELETE FROM bms.automation_rules WHERE id = ANY($1)`, [createdRuleIds]);
      }
      await ownerPool.query(`DELETE FROM bms.automation_rules WHERE code LIKE $1`, [`${PREFIX}%`]);
      const assetIdsToDelete = [assetId, foreignAssetId, decoyAssetId].filter(Boolean);
      if (assetIdsToDelete.length > 0) {
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [assetIdsToDelete]);
      }
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("stamps automation_rules.org from the asset and resolves a non-NULL audit actor", async () => {
    await assertCreateStampsOrgAndActorUnderRealRls(ctx, `${PREFIX}CREATE`);
  });

  it("refuses a global admin's asset-less time_window create (ruling 4), writing nothing", async () => {
    await assertAssetlessTimeWindowRefusedForAdmin(ctx, `${PREFIX}ADMINTW`);
  });

  it("folds the createDraft read-back into the write's tenant transaction (E7.1c)", async () => {
    await assertCreateDraftReadsBackOnTenantTransaction(ctx, `${PREFIX}READBACK`);
  });

  it("folds the updateRule read-back into the write's tenant transaction (E7.1c)", async () => {
    await assertUpdateRuleReadsBackInTenantTransaction(ctx, `${PREFIX}UPDRB`);
  });

  it("folds the publishRule (writeLifecycleUpdate) read-back into the write's tenant transaction (E7.1c)", async () => {
    await assertPublishRuleReadsBackInTenantTransaction(ctx, `${PREFIX}PUBRB`);
  });

  it("404s a scoped actor's asset-less time_window create before org resolution", async () => {
    await assertAssetlessTimeWindowRefusedForScoped(ctx, `${PREFIX}SCOPEDTW`);
  });

  it("returns only the caller's own-org rule on the single-org tenant path", async () => {
    await assertSingleOrgRuleListReturnsOwnRow(ctx);
  });

  it("returns both orgs' rules, and only those, for a two-organization actor (decision 3)", async () => {
    await assertRuleListReturnsBothOrgsForTwoOrgActor(ctx);
  });

  it("runs a single-org listRules on the tenant pool (one tenant transaction, no fleet)", async () => {
    await assertSingleOrgRuleListRunsOnTenantTransaction(ctx);
  });

  it("returns only the caller's own-org execution on the single-org tenant path", async () => {
    await assertSingleOrgRuleExecutionListReturnsOwnRow(ctx);
  });

  it("returns both orgs' executions, and only those, for a two-organization actor (decision 3)", async () => {
    await assertRuleExecutionListReturnsBothOrgsForTwoOrgActor(ctx);
  });

  it("runs a single-org listExecutions on the tenant pool (one tenant transaction, no fleet)", async () => {
    await assertSingleOrgRuleExecutionListRunsOnTenantTransaction(ctx);
  });
});
