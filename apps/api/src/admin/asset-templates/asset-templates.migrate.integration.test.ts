import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import { loadFixtures, type Fixtures } from "./asset-templates.instantiate.integration.spec";
import {
  assertApplyMovesOnlySelectedAssets,
  assertDerivedChangesMigrateFreely,
  assertDomainChangeRefuses,
  assertExistingRowRefusesAMeasuredAddition,
  assertVersionCountsAreScopedToTheCaller,
  assertMeasuredReKeyRefuses,
  assertMeasuredRemovalRefusesAndWritesNothing,
  assertOutOfScopeAssetIsRefused,
  assertPreviewWritesNothing,
  assertReMigrationIsANoOp,
  assertTargetVersionIsValidated,
  assertUnpinnedAssetIsRejected,
  assertUnresolvablePatternRefusesRequiredAndSkipsOptional,
  assertVersionsListIsNewestFirstWithCounts,
  cleanup,
} from "./asset-templates.migrate.integration.spec";

/**
 * `F2.6` U6 — Vitest entry point for template version migration. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.6",
  label: "template version migration tests",
  because:
    "the refusal guarantees are guarantees about rows that must NOT exist afterwards — " +
    "assets.template_id unmoved, no partial asset_points, no audit row claiming a " +
    "migration occurred. Partial migration is the worst outcome this feature can produce " +
    "and no pure test can observe it. Constructing the service with real bms_tenant/" +
    "bms_fleet connections (ADR 0043, not the owner for both pools) is also the only " +
    "proof that withTenant enforces row-level security on the migration write path.",
});

describe.skipIf(!connectionString)("F2.6 — template version migration", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplateMigrationService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F2.6");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.6",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.6",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.6",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetTemplateMigrationService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      // `F2.9` PR 2 review fix 2 — migrate now runs the override endpoint's
      // cycle detector as well, so this hand-wired service needs the real one.
      new CalcDependencyService(
        fleetDb,
        new CalcDefinitionsService(fleetDb, new MetricsService()),
        new CalcScopeService(fleetDb),
      ),
    );
    // `F3.39`: the template points this suite invents (`KW`, `VOLTS`) reach
    // bms.asset_points, whose point_key references point_keys(code) from
    // migration `0057`. See `registerFixturePointKeys`.
    //
    // **`F3.42` adds the other three.** `0058` gives `template_points.point_key`
    // the same foreign key, so a code needs a catalog row even when it never
    // reaches an asset — `PF`, `PANEL_A` and `PANEL_B` are declared by fixture
    // templates and instantiate onto nothing.
    releasePointKeys = await registerFixturePointKeys(created, [
      "KW",
      "VOLTS",
      "KWH",
      "PF",
      "PANEL_A",
      "PANEL_B",
    ]);
    // Fixtures are cross-organization by design and set up on the owner
    // connection on purpose — seeding is not the behaviour under test.
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  // Each case seeds at (org, TEST_TEMPLATE_CODE, version) —
  // asset_templates_org_code_version_unique means a prior case's rows must be
  // gone first. Migration is not a sequence, and chaining these would make a
  // failure in case two look like a failure in case five.
  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("lists versions newest-first with per-version asset and point counts", async () => {
    if (!pool) throw new Error("pool required");
    await assertVersionsListIsNewestFirstWithCounts(pool, svc, fx);
  });

  it("previews a delta and writes nothing at all", async () => {
    if (!pool) throw new Error("pool required");
    await assertPreviewWritesNothing(pool, svc, fx);
  });

  it("applies to exactly the selected assets, creating the added points and one audit row", async () => {
    if (!pool) throw new Error("pool required");
    await assertApplyMovesOnlySelectedAssets(pool, svc, fx);
  });

  it("refuses a measured removal, names the point and the asset count, and writes nothing", async () => {
    if (!pool) throw new Error("pool required");
    await assertMeasuredRemovalRefusesAndWritesNothing(pool, svc, fx);
  });

  it("refuses a measured re-key, naming both patterns", async () => {
    if (!pool) throw new Error("pool required");
    await assertMeasuredReKeyRefuses(pool, svc, fx);
  });

  it("Q-A — refuses a required unresolvable pattern, skips and reports an optional one", async () => {
    if (!pool) throw new Error("pool required");
    await assertUnresolvablePatternRefusesRequiredAndSkipsOptional(pool, svc, fx, cleanup);
  });

  it("Q-B — refuses a target version that declares a different domain", async () => {
    if (!pool) throw new Error("pool required");
    await assertDomainChangeRefuses(pool, svc, fx);
  });

  it("refuses a draft target and a different template code", async () => {
    if (!pool) throw new Error("pool required");
    await assertTargetVersionIsValidated(pool, svc, fx);
  });

  it("refuses the whole batch when one asset is outside the caller's scope", async () => {
    if (!pool) throw new Error("pool required");
    await assertOutOfScopeAssetIsRefused(pool, svc, fx);
  });

  it("migrates derived-only changes freely, creating no asset_points rows", async () => {
    if (!pool) throw new Error("pool required");
    await assertDerivedChangesMigrateFreely(pool, svc, fx);
  });

  it("treats a re-submitted migration as a no-op, with no second audit row", async () => {
    if (!pool) throw new Error("pool required");
    await assertReMigrationIsANoOp(pool, svc, fx);
  });

  it("rejects a hand-created asset that is pinned to no version", async () => {
    if (!pool) throw new Error("pool required");
    await assertUnpinnedAssetIsRejected(pool, svc, fx);
  });

  it("refuses a measured addition onto a point key the asset already has a row for", async () => {
    if (!pool) throw new Error("pool required");
    await assertExistingRowRefusesAMeasuredAddition(pool, svc, fx);
  });

  it("scopes the per-version asset count to the caller's own locations", async () => {
    if (!pool) throw new Error("pool required");
    await assertVersionCountsAreScopedToTheCaller(pool, svc, fx);
  });
});
