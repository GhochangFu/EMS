import pg from "pg";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertArchiveRules,
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
  assertVersionBumpCopiesPoints,
  cleanup,
  loadFixtures,
  type Fixtures,
} from "./asset-templates.lifecycle.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";

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
 * Unlike `F4.10`, these tests write. Everything they create carries the code
 * `F21-LIFECYCLE-TEST` and is deleted before and after the run, so a crashed
 * run cannot poison the next one on a shared local database.
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
    "database behaviours, so a green run without them asserts nothing.",
});

describe.skipIf(!connectionString)("F2.1 — asset template version lifecycle", () => {
  let pool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;
  let v1: AdminAssetTemplateDto;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.1");
    pool = created;

    const db = createDb(created);
    svc = new AssetTemplatesAdminService(
      db,
      new AccessControlService(db),
      new MasterDataAuditService(db),
    );
    fx = await loadFixtures(created);
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("creates version 1 as a draft, points in sort order", async () => {
    v1 = await assertCreateStartsAtVersionOne(svc, fx);
    expect(v1.version).toBe(1);
  });

  it("permits exactly one open draft per (organization, code)", async () => {
    await assertOnlyOneDraftPerCode(svc, fx);
  });

  it("rejects point keys absent from the org's active catalog, naming them", async () => {
    await assertPointKeyCatalogIsEnforced(svc, fx);
  });

  it("freezes a published version against edit, re-publish and delete", async () => {
    await assertPublishFreezes(svc, fx, v1.id);
  });

  it("bumps to version 2 with points copied, and leaves version 1 untouched", async () => {
    await assertVersionBumpCopiesPoints(svc, fx, v1.id);
  });

  it("archives only published versions", async () => {
    await assertArchiveRules(svc, fx, v1.id);
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
    let contentDraft: AdminAssetTemplateDto;

    it("round-trips content through jsonb with its ordering intact", async () => {
      contentDraft = await assertContentRoundTrips(svc, fx);
      expect(contentDraft.content).toHaveProperty("contentVersion", 1);
    });

    it("rejects content naming a catalogued point the template does not declare", async () => {
      await assertContentRefsCheckedOnCreate(svc, fx);
    });

    it("resolves a content-only patch against the stored point set", async () => {
      await assertContentPatchResolvesAgainstStoredPoints(svc, fx, contentDraft.id);
    });

    it("lets a points patch orphan content, then refuses to publish it", async () => {
      await assertOrphanedRefsAreCaughtAtPublish(svc, fx, contentDraft.id);
    });

    it("blocks publish on pre-ADR content but still permits the draft fork", async () => {
      if (!pool) {
        throw new Error("pool is required for the legacy-content case");
      }
      await assertLegacyContentBlocksPublishButNotForking(svc, pool, fx);
    });
  });
});
