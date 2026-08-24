import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
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
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

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

const connectionString = requireIntegrationDb({
  item: "F2.2",
  label: "template instantiation tests",
  because:
    "the rollback guarantees, the asset_points_source_ref_check agreement between rtu_id " +
    "and source_kind, and the ADR 0015 Amendment 1B access split are all database " +
    "behaviours. A green run without them asserts nothing about the one outcome this " +
    "feature must never produce. Constructing every service with real bms_tenant/bms_fleet " +
    "connections (ADR 0043, not the owner for both pools) is also the only proof that " +
    "withTenant enforces row-level security on the instantiation write path.",
});

describe.skipIf(!connectionString)("F2.2 — asset template instantiation", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let fx: Fixtures;
  let template: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F2.2");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.2",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.2",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.2",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), tenantDb, fleetDb);
    const audit = new MasterDataAuditService(tenantDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const instantiation = new AssetTemplateInstantiationService(fleetDb, tenantDb, access, audit);
    svc = {
      templates: new AssetTemplatesAdminService(fleetDb, tenantDb, access, audit, vocabularies),
      // Parse through the real schema so these cases exercise the controller's
      // path, transform included — not a hand-built post-transform shape.
      instantiate: (jwt, templateId, body) =>
        instantiation.instantiate(jwt, templateId, instantiateAssetsBodySchema.parse(body)),
    };
    // Fixtures are cross-organization by design and set up on the owner
    // connection on purpose — seeding is not the behaviour under test.
    fx = await loadFixtures(created);
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
