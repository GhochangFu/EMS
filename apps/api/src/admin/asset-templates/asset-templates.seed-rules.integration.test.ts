import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AlarmRaiser } from "../../alarms/alarm-raise.service";
import { AccessControlService } from "../../auth/access-control.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { RulesService } from "../../rules/rules.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { loadFixtures } from "./asset-templates.instantiate.integration.spec";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import {
  assertIntraBatchCodeCollisionRefused,
  assertJoinPredicateIsNotVacuous,
  assertOneRulePerAlarmPerAsset,
  assertOverflowingCodeIsHashed,
  assertPhilosophyRowCannotBeArmed,
  assertRepublishNeverMovesALiveRule,
  assertTakenRuleCodeRefusesBatch,
  assertUnparseableContentRefusesToInstantiate,
  assertUnresolvablePointWritesNoRules,
  cleanup,
  loadSeedFixtures,
  publishFixtureTemplate,
  type SeedFixtures,
  type Services,
} from "./asset-templates.seed-rules.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `E2.4` / ADR 0058 — Vitest entry point for the template-alarm seed.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle, and follows `F2.2`'s skip/fail semantics exactly.
 *
 * The cases are independent — each resets this suite's assets and rules and
 * instantiates the same published template afresh — with one ordering
 * constraint: the republish case forks the fixture to v2, so it runs after the
 * cases that assert `source_template_version = 1`.
 */
const connectionString = requireIntegrationDb({
  item: "E2.4",
  label: "template alarm rule seeding tests",
  because:
    "every claim ADR 0058 makes is a row that exists or does not exist after a transaction: " +
    "one rule per alarm per asset with four provenance columns, ZERO rule_notifications rows, " +
    "a philosophy row that cannot be armed, and nothing at all left behind when the batch " +
    "aborts. None of it is expressible as a pure function, and two of the guards it proves " +
    "(the setEnabled arming check and the E2.4 Q1 template_points join) have no other " +
    "execution anywhere in the repository — a green run without a database would assert that " +
    "they are wired when nothing has ever called them.",
});

describe.skipIf(!connectionString)("E2.4 — template alarms seed automation rules", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let fx: SeedFixtures;
  let template: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "E2.4");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E2.4",
    );
    // Wider than the default 4, and this is measured rather than defensive.
    // Publishing a template that **carries alarms** reaches
    // `assertTemplateAlarmVocabularies`, which calls `VocabulariesService.list`
    // — six `Promise.all` selects on this one handle. At `max: 4` two of them
    // queue, and `openIntegrationPool`'s 5 s acquisition timeout then expires
    // under full-suite load: this `beforeAll` failed exactly that way with
    // "timeout exceeded when trying to connect". `F2.2`'s fixture carries no
    // alarms, which is why no existing suite has met this.
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E2.4",
      { max: 8, connectionTimeoutMillis: 20_000 },
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E2.4",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
    );
    // Real pools for both halves of `RulesService`, because the two things this
    // suite proves about it are database behaviours. The last two constructor
    // slots are stand-ins: `setEnabled` and `updateRule` neither evaluate nor
    // dispatch, and a stub that resolves (rather than `{}`) means a regression
    // that started calling one would fail on an assertion instead of on a
    // TypeError — the shape `rules.service.spec.ts` uses.
    const alarmRaiser = {} as unknown as AlarmRaiser;
    const notifications = {
      dispatch: () => Promise.resolve([]),
    } as unknown as NotificationsService;
    svc = {
      templates: new AssetTemplatesAdminService(fleetDb, tenantDb, access, audit, vocabularies),
      rules: new RulesService(tenantDb, fleetDb, vocabularies, alarmRaiser, notifications),
      // Parsed through the real schema so these cases exercise the controller's
      // path, transform included — not a hand-built post-transform shape.
      instantiate: (jwt, templateId, body) =>
        instantiation.instantiate(jwt, templateId, instantiateAssetsBodySchema.parse(body)),
    };
    fx = await loadSeedFixtures(created, await loadFixtures(created));
    // Here and not only inside the case that needs it: this guard is what makes
    // the commissioning PATCH a proof of the `E2.4` Q1 join rather than an
    // accident of the hard-coded map, and a guard that a reorder or a `.skip`
    // can bypass is not a guard.
    assertJoinPredicateIsNotVacuous(fx);
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    template = await publishFixtureTemplate(svc, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("seeds one rule per alarm per asset, with provenance, review, and no channel", async () => {
    await assertOneRulePerAlarmPerAsset(svc, fx, pool as pg.Pool, template.id);
  });

  it("hashes a rule code that would overflow varchar(64), and keeps it unique", async () => {
    await assertOverflowingCodeIsHashed(svc, fx, pool as pg.Pool, template.id);
  });

  it("writes no rules when a required point cannot resolve", async () => {
    await assertUnresolvablePointWritesNoRules(svc, fx, pool as pg.Pool, template.id);
  });

  it("refuses the batch when an archived rule already holds a derived code", async () => {
    await assertTakenRuleCodeRefusesBatch(svc, fx, pool as pg.Pool, template.id);
  });

  it("refuses a batch whose asset codes derive one rule code twice", async () => {
    await assertIntraBatchCodeCollisionRefused(svc, fx, pool as pg.Pool, template.id);
  });

  it("refuses to arm a philosophy row, and arms it after one commissioning PATCH", async () => {
    await assertPhilosophyRowCannotBeArmed(svc, fx, pool as pg.Pool, template.id);
  });

  it("refuses to instantiate a version whose stored content no longer parses", async () => {
    await assertUnparseableContentRefusesToInstantiate(svc, fx, pool as pg.Pool, template.id);
  });

  // Last: it forks the fixture to v2, which every case above reads as v1.
  it("never moves a live rule when the template is republished", async () => {
    await assertRepublishNeverMovesALiveRule(svc, fx, pool as pg.Pool, template.id);
  });
});
