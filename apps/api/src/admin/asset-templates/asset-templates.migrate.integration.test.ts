import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
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
    "and no pure test can observe it.",
});

describe.skipIf(!connectionString)("F2.6 — template version migration", () => {
  let pool: pg.Pool | undefined;
  let svc: AssetTemplateMigrationService;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.6");
    pool = created;
    const db = createDb(created);
    svc = new AssetTemplateMigrationService(
      db,
      db,
      new AccessControlService(db, db, db),
      new MasterDataAuditService(db),
    );
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
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
