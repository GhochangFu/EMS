import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { AssetTemplateSeededRulesService } from "./asset-templates-seeded-rules.service";
import { loadFixtures } from "./asset-templates.instantiate.integration.spec";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import {
  cleanup,
  loadSeedFixtures,
  publishFixtureTemplate,
} from "./asset-templates.seed-rules.integration.spec";
import {
  asSeedServices,
  assertFreshSeedReadsInSync,
  assertIncompleteProvenanceIsTolerated,
  assertListIsScopedToWritableLocations,
  assertLocalOverrideIsAttributed,
  assertMessageFixturesAreNotVacuous,
  assertReapplyMovesOnlyTheNamedRules,
  assertReapplyRefusals,
  assertTemplateMoveIsAttributed,
  publishDriftFixture,
  type DriftFixtures,
  type DriftServices,
} from "./asset-templates.seeded-rules-drift.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `E2.4` / ADR 0058 decision 8 — Vitest entry point for the seeded-rules
 * drift list and re-apply. Assertions live in the sibling `.spec` (ADR 0014);
 * this file owns the database lifecycle and follows the seed suite's
 * skip/fail semantics exactly.
 *
 * The cases reset this suite's assets and rules and re-instantiate, with one
 * ordering constraint: `assertTemplateMoveIsAttributed` forks the fixture to
 * v2, and every case after it re-applies from that v2. The cases before it
 * assert `currentVersion` is v1.
 */
const connectionString = requireIntegrationDb({
  item: "E2.4",
  label: "seeded-rules drift and re-apply tests",
  because:
    "a drift verdict is a comparison of three values, two of which are rows: the rule's own " +
    "columns and the seeded_baseline jsonb the seed wrote. The PR 1 review named two hazards " +
    "only a database can hold — a current built from the raw message reporting template_moved " +
    "on every long, short or padded message, and a row whose provenance is half-NULL — and the " +
    "writable-location scoping ruled on 2026-09-07 is a join against the caller's grants. " +
    "Without a database this file would assert that the verdicts are computed over rows " +
    "nothing ever wrote.",
});

/** See the note at the end of `beforeAll`. */
const HOOK_TIMEOUT_MS = 60_000;

describe.skipIf(!connectionString)("E2.4 — seeded-rules drift list and re-apply", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: DriftServices;
  let fx: DriftFixtures;
  let v1: AdminAssetTemplateDto;
  let v2: AdminAssetTemplateDto;
  let otherTemplate: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "E2.4");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E2.4",
    );
    // Wider than the default 4, for the reason the seed suite's wrapper
    // measured: publishing a template that carries alarms reaches
    // `VocabulariesService.list` — six `Promise.all` selects on this handle —
    // and this suite publishes three versions.
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
      seededRules: new AssetTemplateSeededRulesService(
        fleetDb,
        tenantDb,
        access,
        audit,
        // The PR 2 security review's S2: re-apply now runs the same live
        // vocabulary gate instantiate does, so it takes the same collaborator.
        vocabularies,
      ),
    };
    const base = await loadFixtures(created);
    fx = {
      ...(await loadSeedFixtures(created, base)),
      otherLocationId: base.otherLocationId,
      locationAdminJwt: base.locationAdminJwt,
    };
    // Here and not only inside the case that needs it: a guard a reorder or a
    // `.skip` can bypass is not a guard.
    assertMessageFixturesAreNotVacuous();
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    v1 = await publishDriftFixture(svc, fx);
    // The seed suite's own template, under a different code — the "another
    // template" the 404 case needs a rule to have been seeded from.
    otherTemplate = await publishFixtureTemplate(asSeedServices(svc), fx);
    // Measured, not defensive: this hook publishes TWO alarm-carrying templates
    // and each publish reaches `VocabulariesService.list`, so on a cold pool
    // the first run took 20 s against Vitest's 10 s default and the whole
    // suite then reported "7 skipped" — a false green one `tail` away.
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, HOOK_TIMEOUT_MS);

  it("reads in_sync on a fresh seed, for a long, a short and a padded message", async () => {
    await assertFreshSeedReadsInSync(svc, fx, pool as pg.Pool, v1);
  });

  it("attributes an engineer's edit as local_override", async () => {
    await assertLocalOverrideIsAttributed(svc, fx, pool as pg.Pool, v1);
  });

  it("scopes the list to the caller's writable locations", async () => {
    await assertListIsScopedToWritableLocations(svc, fx, pool as pg.Pool, v1);
  });

  it("tolerates a row whose provenance is incomplete, and refuses to re-apply it", async () => {
    await assertIncompleteProvenanceIsTolerated(svc, fx, pool as pg.Pool, v1);
  });

  // Forks the fixture to v2. Every case above reads v1 as current.
  it("attributes a republish as template_moved, both_moved, or a null current", async () => {
    v2 = await assertTemplateMoveIsAttributed(svc, fx, pool as pg.Pool, v1);
  });

  it("re-applies only the named rules, arms the one it completes, and never disables", async () => {
    await assertReapplyMovesOnlyTheNamedRules(svc, fx, pool as pg.Pool, v1, v2);
  });

  it("refuses a foreign rule (404), a vanished alarm (400) and another location (403)", async () => {
    await assertReapplyRefusals(svc, fx, pool as pg.Pool, v1, otherTemplate);
  });
});
