import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { loadFixtures } from "./asset-templates.instantiate.integration.spec";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import {
  assertRetiredCategoryRefusesToInstantiate,
  assertRetiredSeverityRefusesToInstantiate,
  publishRetiredVocabularyFixture,
  removeFixtureVocabulary,
  type VocabularyServices,
} from "./asset-templates.seed-rules-vocab.integration.spec";
import {
  cleanup,
  loadSeedFixtures,
  type SeedFixtures,
} from "./asset-templates.seed-rules.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `E2.4` — Vitest entry point for "the vocabulary was retired after publish".
 *
 * Its own wrapper rather than two more cases on
 * `asset-templates.seed-rules.integration.test.ts`: the assertions live in a
 * sibling `.spec` (ADR 0014) because that suite's spec stands at 989 of
 * AGENTS.md §4.5's 1000 lines, and ADR 0014's structural invariant asks every
 * spec for a wrapper of its own name. The fixtures are that suite's fixtures,
 * imported rather than rebuilt — and because each Vitest file evaluates the
 * module afresh, this suite's `TEST_TEMPLATE_CODE` and `TEST_ASSET_PREFIX` are
 * a different per-run pair, so the two suites cannot sweep each other's rows.
 */
const connectionString = requireIntegrationDb({
  item: "E2.4",
  label: "retired alarm vocabulary tests",
  because:
    "the claim is about the state of two lookup tables at the moment a frozen template is " +
    "instantiated: a severity and a category that were live when the version was published and " +
    "are `active = false` by the time somebody presses the button. Nothing about that is " +
    "expressible as a pure function — the vocabulary rows are rows, the refusal must leave " +
    "ZERO assets and ZERO automation_rules behind, and the counts that prove it are independent " +
    "SQL. Without a database this file would assert that the guard is wired when nothing has " +
    "ever called it.",
});

describe.skipIf(!connectionString)("E2.4 — a vocabulary retired after publish", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: VocabularyServices;
  let fx: SeedFixtures;
  let templateId: string;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "E2.4");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E2.4",
    );
    // Wider than the default 4, for the reason the sibling wrapper measured:
    // publishing a template that **carries alarms** reaches
    // `assertTemplateAlarmVocabularies`, which calls `VocabulariesService.list`
    // — six `Promise.all` selects on this one handle. At `max: 4` two of them
    // queue and the 5 s acquisition timeout expires under full-suite load. This
    // suite additionally calls `list` on the *instantiate* path, which is the
    // guard it exists to prove.
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
    svc = {
      templates: new AssetTemplatesAdminService(fleetDb, tenantDb, access, audit, vocabularies),
      // Parsed through the real schema so these cases exercise the controller's
      // path, transform included — not a hand-built post-transform shape.
      instantiate: (jwt, id, body) =>
        instantiation.instantiate(jwt, id, instantiateAssetsBodySchema.parse(body)),
    };
    fx = await loadSeedFixtures(created, await loadFixtures(created));
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    templateId = await publishRetiredVocabularyFixture(svc, fx, created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      // After `cleanup`, never before: `automation_rules.category`/`.severity`
      // are foreign keys, so a surviving seeded rule would make this a `23503`
      // instead of leaving the two lookup tables as this run found them.
      await removeFixtureVocabulary(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("refuses to instantiate a version whose alarm severity was retired after publish", async () => {
    await assertRetiredSeverityRefusesToInstantiate(svc, fx, pool as pg.Pool, templateId);
  });

  it("refuses to instantiate a version whose alarm category was retired after publish", async () => {
    await assertRetiredCategoryRefusesToInstantiate(svc, fx, pool as pg.Pool, templateId);
  });
});
