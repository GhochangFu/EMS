import pg from "pg";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertArchiveRules,
  assertCalcFieldsSurviveUpdateRoundTrip,
  assertContentPatchResolvesAgainstStoredPoints,
  assertContentRefsCheckedOnCreate,
  assertContentRoundTrips,
  assertCreateStartsAtVersionOne,
  assertEmptyDraftCannotPublish,
  assertLegacyContentBlocksPublishButNotForking,
  assertLocationAdminCannotAuthor,
  assertOnlyOneDraftPerCode,
  assertOrphanedRefsAreCaughtAtPublish,
  assertPointKeyCatalogIsEnforced,
  assertPublishFreezes,
  assertUnknownSkillRejectedOnCreate,
  assertVersionBumpCopiesPoints,
  cleanup,
  loadFixtures,
  sweepStaleRuns,
  type Fixtures,
} from "./asset-templates.lifecycle.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F2.1` — Vitest entry point for the ADR 0015 lifecycle. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * Skip/fail semantics match `F4.10`'s access-control suite exactly: an unset
 * `DATABASE_URL` skips locally and throws under `CI`, while a *set* one is a
 * claim that a database exists, so a failed connection fails everywhere. The
 * gate is duplicated between the two files rather than shared — extracting it
 * needs a home that is neither a `.spec` (which would want a pointless wrapper)
 * nor a plain source file (which would ship in the Nest build and land in the
 * coverage denominator). Worth doing once a third integration suite exists.
 *
 * Unlike `F4.10`, these tests write. Everything they create carries `TEST_CODE`,
 * which is `F21-LIFECYCLE-TEST-` plus a per-run suffix, and only that code is
 * deleted afterwards. The suffix is what makes a second instance of this file on
 * the same database harmless rather than mutually destructive — the 2026-08-24
 * flake, whose mechanism and reproduction are recorded on `TEST_CODE` in the
 * sibling `.spec`. Rows from older runs are swept by age in `beforeAll`.
 *
 * The tests run in sequence and share state: each stage is the previous stage's
 * output. That is the point — a version lifecycle is only meaningful as a
 * sequence, and testing "publish" against a freshly minted draft would not
 * prove that publishing v2 leaves v1 alone.
 */

const connectionString = requireIntegrationDb({
  item: "F2.1",
  label: "asset-template lifecycle tests",
  because:
    "the version-bump rule, the one-draft-per-code index and published-row immutability are " +
    "database behaviours, so a green run without them asserts nothing. Constructing the " +
    "service with real bms_tenant/bms_fleet connections (ADR 0043, not the owner for both " +
    "pools) is also the only proof that withTenant actually enforces row-level security on " +
    "this service's writes rather than passing because the owner bypasses it regardless.",
});

/**
 * The stages below share state on purpose, so a stage whose input never
 * arrived must say *that* rather than dereference `undefined`.
 *
 * Without this the first real failure is followed by
 * `TypeError: Cannot read properties of undefined (reading 'id')` from every
 * later stage, and those are what a reader sees first — they carry no cause,
 * point at the wrong line, and are the reason the 2026-08-24 report of this
 * suite's flake named two innocent assertions and not the one that broke.
 */
function stageOutput<T>(value: T | undefined, produced: string): T {
  if (value === undefined) {
    throw new Error(
      `this stage needs the ${produced}, which was never produced: an earlier stage in ` +
        "this file failed. Read that failure — the stages share state by design (see the " +
        "file header), so this one could not run.",
    );
  }
  return value;
}

describe.skipIf(!connectionString)("F2.1 — asset template version lifecycle", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;
  let v1: AdminAssetTemplateDto | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F2.1");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.1",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.1",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.1",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb),
      new VocabulariesService(tenantDb),
    );
    // Fixtures are cross-organization by design and read on the `bms_fleet`
    // connection on purpose — seeding is not the behaviour under test. (That
    // is what `requireIntegrationDb` returns by default since ADR 0045; this
    // comment used to say "the owner connection", which stopped being true
    // when `E7.1a` made `bms_owner` a non-superuser bound by `FORCE`.)
    fx = await loadFixtures(created);
    // Rows from an *older* run, which this run's own code can no longer
    // collide with — see `sweepStaleRuns`. Non-fatal on purpose: it is
    // hygiene, not a precondition.
    await sweepStaleRuns(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("creates version 1 as a draft, points in sort order", async () => {
    v1 = await assertCreateStartsAtVersionOne(svc, fx);
    expect(v1.version).toBe(1);
  });

  it("round-trips ADR 0037 calc fields through a PATCH that echoes them back (F2.4)", async () => {
    await assertCalcFieldsSurviveUpdateRoundTrip(svc, fx, stageOutput(v1, "version 1 draft"));
  });

  it("permits exactly one open draft per (organization, code)", async () => {
    await assertOnlyOneDraftPerCode(svc, fx, stageOutput(v1, "version 1 draft"));
  });

  it("rejects point keys absent from the org's active catalog, naming them", async () => {
    await assertPointKeyCatalogIsEnforced(svc, fx);
  });

  it("freezes a published version against edit, re-publish and delete", async () => {
    await assertPublishFreezes(svc, fx, stageOutput(v1, "version 1 draft").id);
  });

  it("bumps to version 2 with points copied, and leaves version 1 untouched", async () => {
    await assertVersionBumpCopiesPoints(svc, fx, stageOutput(v1, "version 1 draft").id);
  });

  it("archives only published versions", async () => {
    await assertArchiveRules(svc, fx, stageOutput(v1, "version 1 draft").id);
  });

  it("saves an empty draft but refuses to publish it", async () => {
    await assertEmptyDraftCannotPublish(svc, fx);
  });

  it("excludes location admins from authoring (ADR 0015 §7)", async () => {
    await assertLocationAdminCannotAuthor(svc, fx);
  });

  // `E1.7` / ADR 0019. Same fixtures and same cleanup as the lifecycle above,
  // rather than a fourth copy of this file's DATABASE_URL gate.
  describe("E1.7 — template content model", () => {
    let contentDraft: AdminAssetTemplateDto | undefined;

    it("round-trips content through jsonb with its ordering intact", async () => {
      contentDraft = await assertContentRoundTrips(svc, fx);
      expect(contentDraft.content).toHaveProperty("contentVersion", 1);
    });

    it("rejects content naming a catalogued point the template does not declare", async () => {
      await assertContentRefsCheckedOnCreate(svc, fx);
    });

    it("rejects an unknown philosophy.skill on create (ADR 0034)", async () => {
      await assertUnknownSkillRejectedOnCreate(svc, fx);
    });

    it("resolves a content-only patch against the stored point set", async () => {
      await assertContentPatchResolvesAgainstStoredPoints(
        svc,
        fx,
        stageOutput(contentDraft, "content draft").id,
      );
    });

    it("lets a points patch orphan content, then refuses to publish it", async () => {
      await assertOrphanedRefsAreCaughtAtPublish(
        svc,
        fx,
        stageOutput(contentDraft, "content draft").id,
      );
    });

    it("blocks publish on pre-ADR content but still permits the draft fork", async () => {
      if (!pool) {
        throw new Error("pool is required for the legacy-content case");
      }
      await assertLegacyContentBlocksPublishButNotForking(svc, pool, fx);
    });
  });
});
