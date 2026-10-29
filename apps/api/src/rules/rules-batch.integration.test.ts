import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { pointKeysForAsset } from "./rule-points";
import { RulesBatchService } from "./rules-batch.service";
import {
  aCodeTakenInAnotherOrganizationDoesNotMoveTheGeneratedCode,
  aFailureInsideTheTransactionCreatesNothing,
  anExplicitCodeLaterInTheBatchIsNotGeneratedForAnEarlierRow,
  aRowOutsideTheReadableAssetsIsRefusedWithTheRouteSentence,
  aRowTheValidatorRefusesNamesItsRow,
  everyAuditRowCarriesTheCopilotMark,
  everyRowExcludedIsRefused,
  everyRuleHasADraftCreateAndAPublishAuditRow,
  excludedRowsAreNotCreated,
  outsideACopilotChangeNoAuditRowCarriesTheMark,
  rowsOnTwoOrganizationsAreRefusedBeforeAnyWrite,
  type RulesBatchFixtures,
  threeRowsBecomeThreePublishedEnabledRules,
  twoRowsWithTheSameExplicitCodeAreRefused,
  twoRowsWithTheSameNameGetDistinctCodes,
} from "./rules-batch.integration.spec";
import { RulesService } from "./rules.service";

/**
 * `F4.289` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: three fixture assets (two
 * in the PHE admin's organization, one in a second organization), committed
 * with ids registered before the insert, and every rule on them, with its audit
 * rows, deleted in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.289",
  label: "RulesBatchService.createAndPublish against real, non-owner roles",
  because:
    "the batch creates and publishes up to 25 rules in one withTenant transaction and audits " +
    "two rows per rule through the funnel. Only a real bms_tenant connection proves the rows " +
    "are stored published under the organization's GUC, that a failed audit write rolls every " +
    "insert back, and that a later row on another organization is refused before any write.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run fixture prefix (F4.65): every rule name, explicit code and asset code
// starts with it. randomUUID() sits in PREFIX's own declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `F4289-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("F4.289 — RulesBatchService under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: RulesBatchFixtures;
  // Registered before the insert, so a failure between insert and assignment leaves nothing behind.
  const fixtureAssetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.289");
    await primeSeededSubjects(ownerPool);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.289",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    const orgA = org.rows[0]?.id;
    if (!orgA) throw new Error(`F4.289: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    const other = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [orgA],
    );
    const orgB = other.rows[0]?.id;
    if (!orgB) throw new Error("F4.289: need a second seeded organization — run pnpm db:seed.");
    const locationOf = async (organizationId: string): Promise<string> => {
      const loc = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [organizationId],
      );
      if (!loc.rows[0]) throw new Error(`F4.289: org ${organizationId} has no active location — run pnpm db:seed.`);
      return loc.rows[0].id;
    };
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const domain = dom.rows[0]?.code;
    if (!domain) throw new Error("F4.289: no active asset_domain — run pnpm db:seed.");

    const fleetDb = createDb(ownerPool);
    const seedAsset = async (organizationId: string, suffix: string): Promise<{ id: string; pointKey: string }> => {
      const id = randomUUID();
      fixtureAssetIds.push(id);
      const code = `${PREFIX}${suffix}`;
      await fleetDb.insert(assets).values({
        id,
        organizationId,
        code,
        name: `F4.289 batch asset ${suffix}`,
        siteName: "F4.289 Site",
        locationId: await locationOf(organizationId),
        domain,
        active: true,
      });
      return { id, pointKey: pointKeysForAsset(domain, code)[0] as string };
    };
    const assetA1 = await seedAsset(orgA, "A1");
    const assetA2 = await seedAsset(orgA, "A2");
    const assetB = await seedAsset(orgB, "B");

    const tenantDb = createDb(tenantPool);
    const notifications = { dispatch: () => Promise.resolve([]) } as unknown as NotificationsService;
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const rules = new RulesService(tenantDb, fleetDb, new VocabulariesService(fleetDb), new AlarmRaiser(tenantDb), notifications, audit);
    const failingAudit = {
      writeMany: () => Promise.reject(new Error("F4.289: the audit write fails on purpose")),
    } as unknown as MasterDataAuditService;
    ctx = {
      service: new RulesBatchService(tenantDb, fleetDb, rules, audit),
      failingAuditService: new RulesBatchService(tenantDb, fleetDb, rules, failingAudit),
      ownerPool,
      assetA1: assetA1.id,
      assetA2: assetA2.id,
      assetB: assetB.id,
      pointA1: assetA1.pointKey,
      pointA2: assetA2.pointKey,
      pointB: assetB.pointKey,
      prefix: PREFIX,
      actor: { sub: jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin").sub, email: ORGANIZATION_ADMIN_EMAIL },
    };
  });

  afterAll(async () => {
    if (ownerPool && fixtureAssetIds.length > 0) {
      const rules = await ownerPool.query<{ id: string }>("SELECT id FROM bms.automation_rules WHERE asset_id = ANY($1)", [fixtureAssetIds]);
      const ruleIds = rules.rows.map((row) => row.id);
      if (ruleIds.length > 0) {
        await ownerPool.query("DELETE FROM bms.rule_executions WHERE rule_id = ANY($1)", [ruleIds]);
        await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_type = 'automation_rule' AND entity_id = ANY($1)", [ruleIds]);
        await ownerPool.query("DELETE FROM bms.automation_rules WHERE id = ANY($1)", [ruleIds]);
      }
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [fixtureAssetIds]);
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((pool) => pool.end()));
  });

  it("three rows become three published, enabled rules", () => threeRowsBecomeThreePublishedEnabledRules(ctx));
  it("every rule has a draft-create and a publish audit row", () => everyRuleHasADraftCreateAndAPublishAuditRow(ctx));
  it("every audit row carries the copilot mark inside a copilot change", () => everyAuditRowCarriesTheCopilotMark(ctx));
  it("outside a copilot change no audit row carries the mark", () => outsideACopilotChangeNoAuditRowCarriesTheMark(ctx));
  it("a failure inside the transaction creates nothing", () => aFailureInsideTheTransactionCreatesNothing(ctx));
  it("excluded rows are not created", () => excludedRowsAreNotCreated(ctx));
  it("every row excluded is refused", () => everyRowExcludedIsRefused(ctx));
  it("rows on two organizations are refused before any write", () => rowsOnTwoOrganizationsAreRefusedBeforeAnyWrite(ctx));
  it("a row outside the readable assets is refused with the route sentence", () => aRowOutsideTheReadableAssetsIsRefusedWithTheRouteSentence(ctx));
  it("a row the validator refuses names its row", () => aRowTheValidatorRefusesNamesItsRow(ctx));
  it("two rows with the same name get distinct codes", () => twoRowsWithTheSameNameGetDistinctCodes(ctx));
  it("two rows with the same explicit code are refused", () => twoRowsWithTheSameExplicitCodeAreRefused(ctx));
  it("an explicit code later in the batch is not generated for an earlier row", () => anExplicitCodeLaterInTheBatchIsNotGeneratedForAnEarlierRow(ctx));
  it("a code taken in another organization does not move the generated code", () => aCodeTakenInAnotherOrganizationDoesNotMoveTheGeneratedCode(ctx));
});
