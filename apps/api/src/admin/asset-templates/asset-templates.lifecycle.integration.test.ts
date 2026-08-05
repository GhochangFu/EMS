import pg from "pg";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertArchiveRules,
  assertCreateStartsAtVersionOne,
  assertEmptyDraftCannotPublish,
  assertLocationAdminCannotAuthor,
  assertOnlyOneDraftPerCode,
  assertPointKeyCatalogIsEnforced,
  assertPublishFreezes,
  assertVersionBumpCopiesPoints,
  cleanup,
  loadFixtures,
  type Fixtures,
} from "./asset-templates.lifecycle.integration.spec";

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

const isCi = process.env.CI === "true" || process.env.CI === "1";
const connectionString = process.env.DATABASE_URL;

if (!connectionString && isCi) {
  throw new Error(
    "F2.1 asset-template lifecycle tests have no DATABASE_URL in CI. Refusing to skip — " +
      "the version-bump rule, the one-draft-per-code index and published-row immutability " +
      "are database behaviours, so a green run without them asserts nothing.",
  );
}

if (!connectionString) {
  process.stderr.write(
    "\n[F2.1] Skipping asset-template lifecycle tests: DATABASE_URL is not set.\n" +
      "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
      "        DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms pnpm test:coverage\n" +
      "        (5432 is the committed compose port; docker-compose.override.yml may remap it)\n\n",
  );
}

describe.skipIf(!connectionString)("F2.1 — asset template version lifecycle", () => {
  let pool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;
  let v1: AdminAssetTemplateDto;

  beforeAll(async () => {
    const created = new pg.Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5_000,
    });
    try {
      await created.query("SELECT 1");
    } catch (err) {
      await created.end().catch(() => undefined);
      const detail =
        err instanceof Error
          ? [err.message, (err as NodeJS.ErrnoException).code].filter(Boolean).join(" ") ||
            err.name
          : String(err);
      throw new Error(
        `F2.1 could not reach DATABASE_URL: ${detail}. Setting DATABASE_URL is a claim ` +
          "that a database exists, so this fails rather than skipping.",
      );
    }
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
});
