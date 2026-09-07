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
import { cleanup, loadSeedFixtures } from "./asset-templates.seed-rules.integration.spec";
import type {
  DriftFixtures,
  DriftServices,
} from "./asset-templates.seeded-rules-drift.integration.spec";
import {
  assertReapplyRefusesAMovedPoint,
  assertReapplyRefusesARemovedLimit,
  assertReapplyRefusesARetiredVocabulary,
  assertReapplyRefusesAnArchivedRule,
  assertReapplyRefusesAnUnreadableLiveRow,
  publishGuardFixture,
  publishGuardV2,
} from "./asset-templates.seeded-rules-guards.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `E2.4` / ADR 0058 decision 8 — Vitest entry point for the four re-apply
 * refusals the PR 2 review round added. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * A third file beside the drift pair, not a fifth case in it: that spec stands
 * against AGENTS.md §4.5's 1000-line cap, and these cases need a template
 * whose v2 changes shapes the drift fixture must not change.
 *
 * `TEST_TEMPLATE_CODE` and `TEST_ASSET_PREFIX` are `randomUUID()` at module
 * scope and each Vitest file evaluates the module afresh, so this suite's
 * template, assets and `cleanup2` sweep are a different per-run set from the
 * drift suite's — the two can run in parallel against one database.
 */
const connectionString = requireIntegrationDb({
  item: "E2.4",
  label: "seeded-rules re-apply guard tests",
  because:
    "each of these four refusals exists because the write it prevents is invisible afterwards: " +
    "a rule left enabled with a null operator, a v2 threshold on a v1 point, an armed archived " +
    "rule, and a withdrawn vocabulary code on a live rule. Every one of them is a claim about " +
    "rows — the refusal AND that nothing moved — so without a database this file would assert " +
    "that guards fire over rows nothing ever wrote.",
});

/** The drift wrapper measured this: publishing an alarm-carrying template reaches
 * `VocabulariesService.list`, six parallel selects on the tenant handle, and this
 * hook publishes two versions. Re-apply now reaches it too. */
const HOOK_TIMEOUT_MS = 60_000;

describe.skipIf(!connectionString)("E2.4 — seeded-rules re-apply guards", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: DriftServices;
  let fx: DriftFixtures;
  let v1: AdminAssetTemplateDto;
  let v2: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "E2.4");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E2.4",
    );
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
      instantiate: (jwt, id, body) =>
        instantiation.instantiate(jwt, id, instantiateAssetsBodySchema.parse(body)),
      seededRules: new AssetTemplateSeededRulesService(
        fleetDb,
        tenantDb,
        access,
        audit,
        vocabularies,
      ),
    };
    const base = await loadFixtures(created);
    fx = {
      ...(await loadSeedFixtures(created, base)),
      otherLocationId: base.otherLocationId,
      locationAdminJwt: base.locationAdminJwt,
    };
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    v1 = await publishGuardFixture(svc, fx);
    // Published in the hook, not in a case: every case re-applies from v2, and
    // v1 stays published so the rules are seeded with v1's values.
    v2 = await publishGuardV2(svc, fx, v1);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, HOOK_TIMEOUT_MS);

  it("refuses to re-apply a version that removed the rule's limit (owner ruling R1)", async () => {
    await assertReapplyRefusesARemovedLimit(svc, fx, pool as pg.Pool, v1);
  });

  it("refuses to re-apply an alarm the version moved to another point (owner ruling R2)", async () => {
    await assertReapplyRefusesAMovedPoint(svc, fx, pool as pg.Pool, v1);
  });

  it("refuses an archived rule instead of arming it (S1)", async () => {
    await assertReapplyRefusesAnArchivedRule(svc, fx, pool as pg.Pool, v1);
  });

  it("names the live columns as well as the provenance in the no-verdict 409 (N1)", async () => {
    await assertReapplyRefusesAnUnreadableLiveRow(svc, fx, pool as pg.Pool, v1);
  });

  it("refuses a version naming a category that is no longer live (S2)", async () => {
    await assertReapplyRefusesARetiredVocabulary(svc, fx, pool as pg.Pool, v1, v2);
  });
});
