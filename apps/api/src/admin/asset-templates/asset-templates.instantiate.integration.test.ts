import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertCollidingCodeRollsBackBatch,
  assertCrossOrgTargetRejected,
  assertInactiveTargetRejected,
  assertLocationAdminDeploysButCannotAuthor,
  assertLocationPathProducesUnmappedPoints,
  assertOnlyPublishedTemplatesInstantiate,
  assertCollisionDisclosureIsScoped,
  assertOptionalPointIsSkippedAndReported,
  assertPrototypeTokensDoNotResolve,
  assertRequiredPointAbortsWholeBatch,
  assertRtuPathProducesMeasuredPoints,
  cleanup,
  loadFixtures,
  publishFixtureTemplate,
  type Fixtures,
  type Services,
} from "./asset-templates.instantiate.integration.spec";

/**
 * `F2.2` — Vitest entry point for template instantiation. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * Skip/fail semantics match `F4.10` and `F2.1` exactly: an unset `DATABASE_URL`
 * skips locally and throws under `CI`, while a *set* one is a claim that a
 * database exists, so a failed connection fails everywhere.
 *
 * Unlike `F2.1`'s lifecycle suite, these cases are independent — each cleans up
 * its own assets and starts from the same published template. Instantiation is
 * not a sequence, and chaining them would make a failure in case two look like
 * a failure in case five.
 */

const isCi = process.env.CI === "true" || process.env.CI === "1";
const connectionString = process.env.DATABASE_URL;

if (!connectionString && isCi) {
  throw new Error(
    "F2.2 instantiation tests have no DATABASE_URL in CI. Refusing to skip — the rollback " +
      "guarantees, the asset_points_source_ref_check agreement between rtu_id and source_kind, " +
      "and the ADR 0015 Amendment 1B access split are all database behaviours. A green run " +
      "without them asserts nothing about the one outcome this feature must never produce.",
  );
}

if (!connectionString) {
  process.stderr.write(
    "\n[F2.2] Skipping template instantiation tests: DATABASE_URL is not set.\n" +
      "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
      "        DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms pnpm test:coverage\n" +
      "        (5432 is the committed compose port; docker-compose.override.yml may remap it)\n\n",
  );
}

describe.skipIf(!connectionString)("F2.2 — asset template instantiation", () => {
  let pool: pg.Pool | undefined;
  let svc: Services;
  let fx: Fixtures;
  let template: AdminAssetTemplateDto;

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
        `F2.2 could not reach DATABASE_URL: ${detail}. Setting DATABASE_URL is a claim ` +
          "that a database exists, so this fails rather than skipping.",
      );
    }
    pool = created;

    const db = createDb(created);
    const access = new AccessControlService(db);
    const audit = new MasterDataAuditService(db);
    const instantiation = new AssetTemplateInstantiationService(db, access, audit);
    svc = {
      templates: new AssetTemplatesAdminService(db, access, audit),
      // Parse through the real schema so these cases exercise the controller's
      // path, transform included — not a hand-built post-transform shape.
      instantiate: (jwt, templateId, body) =>
        instantiation.instantiate(jwt, templateId, instantiateAssetsBodySchema.parse(body)),
    };
    fx = await loadFixtures(created);
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    template = await publishFixtureTemplate(svc, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("builds measured points carrying the RTU, and never the derived point", async () => {
    await assertRtuPathProducesMeasuredPoints(svc, fx, pool as pg.Pool, template.id);
  });

  it("builds gateway-less assets with unmapped points from a location target", async () => {
    await assertLocationPathProducesUnmappedPoints(svc, fx, pool as pg.Pool, template.id);
  });

  it("skips an optional point with no resolvable key, and names it", async () => {
    await assertOptionalPointIsSkippedAndReported(svc, fx, pool as pg.Pool, template.id);
  });

  it("writes nothing when a required point cannot resolve", async () => {
    await assertRequiredPointAbortsWholeBatch(svc, fx, pool as pg.Pool, template.id);
  });

  it("rolls back the whole batch on a colliding asset code", async () => {
    await assertCollidingCodeRollsBackBatch(svc, fx, pool as pg.Pool, template.id);
  });

  it("refuses to instantiate anything but a published version", async () => {
    await assertOnlyPublishedTemplatesInstantiate(svc, fx, template.id);
  });

  it("refuses a target in another organization", async () => {
    await assertCrossOrgTargetRejected(svc, fx, template.id);
  });

  it("refuses an inactive target location", async () => {
    await assertInactiveTargetRejected(svc, fx, template.id);
  });

  it("lets a location admin deploy but not author (ADR 0015 Amendment 1B)", async () => {
    await assertLocationAdminDeploysButCannotAuthor(svc, fx, pool as pg.Pool, template.id);
  });

  it("counts but does not name a colliding code outside the caller's scope", async () => {
    await assertCollisionDisclosureIsScoped(svc, fx, pool as pg.Pool, template.id);
  });

  it("treats a prototype-inherited pattern token as unresolved", async () => {
    await assertPrototypeTokensDoNotResolve(svc, fx, pool as pg.Pool);
  });
});
