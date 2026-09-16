import { Logger } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { createAwsS3Ops } from "../storage/aws-s3-ops";
import { createStorageClient, ensureBucket } from "../storage/storage-client";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { createFixtureAssets, type FixtureLocation } from "../testing/integration-fixtures";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import { asRole } from "../testing/role-urls";
import {
  assertAFailedRowWriteLeavesNoRow,
  assertAFailedRowWriteRejectsWithTheOriginalError,
  assertAFailedRowWriteRemovesTheObject,
  assertAnInsertStampedWithAnotherOrganizationIsRefused,
  assertContentStreamsTheUploadedBytes,
  assertRemoveDeletesTheObject,
  assertRemoveDeletesTheObjectOnlyAfterTheRowIsGone,
  assertRemoveDeletesTheRow,
  assertRemoveResolvesWhenTheObjectDeleteFails,
  assertRemoveWritesTheDeleteAuditRow,
  assertTheCapLeavesExactlyTwentyRows,
  assertTheCorrectlyStampedInsertIsAccepted,
  assertTheCreateAuditPayloadOmitsTheFilenameAndCaption,
  assertTheCreateAuditRowCarriesTheAssetsOrganization,
  assertTheCreateAuditRowNamesAnActor,
  assertTheOrphanObjectStaysInTheBucket,
  assertTheOrphanWarnNamesTheImageIdOnce,
  assertTheOrphanWarnNeverNamesTheKey,
  assertTheRefusedUploadPutNoObject,
  assertTheRowIsGoneWhenTheObjectDeleteFails,
  assertTheStoredKeyIsTheBuiltKey,
  assertTheUploadIsListedWithoutTheObjectKey,
  assertTheUploadPastTheCapIsAConflict,
  assertUploadReturnsADtoWithoutTheObjectKey,
  type AssetImageWriteFixtures,
} from "./asset-images-write.integration.spec";

/**
 * `F3.4` — Vitest entry point for the asset-image **write** integration suite.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014); this file owns the
 * three lifecycles: the database's, the bucket's and the fixtures'.
 *
 * **Two gates, and they are not interchangeable.** `requireIntegrationDb`
 * decides on `DATABASE_URL`, `requireIntegrationStorage` on
 * `OBJECT_STORAGE_ENDPOINT`; either unset skips locally and refuses in CI, and
 * a set-but-broken value fails in both. `describe.skipIf` takes both, so a
 * machine with a database and no MinIO skips rather than failing.
 *
 * **Two committed fixture assets, deleted by id.** The write service resolves
 * the asset's organization on the fleet pool and then writes on a second
 * connection, so an uncommitted fixture is invisible to it — these rows cannot
 * use the rollback style, and the one row that can (`0072`'s refusal) builds
 * its own asset inside its own transaction. The teardown deletes the two by id
 * — never by a `code LIKE` sweep, which would delete a concurrent instance's
 * fixtures (`tests/integration-fixture-isolation.test.ts`) — and `ON DELETE
 * CASCADE` takes any surviving image row with them. The cap row owns the
 * second asset alone: sharing one would make its 21st upload's 409 ambiguous.
 *
 * **The audit rows this suite commits are swept by the fixtures' own asset
 * ids.** `bms.audit_log` has no cascade to `bms.assets`, so the two actions
 * every upload and delete writes would otherwise outlive the fixtures. The
 * sweep reads `payload->>'assetId'`, which is bounded by ids this run created
 * — not by a shared prefix.
 *
 * The bucket is ensured once here, as `StorageBootstrap` does at boot, so the
 * rows that put objects do not each race to create it.
 */
const connectionString = requireIntegrationDb({
  item: "F3.4",
  label: "asset image write-path integration tests",
  because:
    "these are the only tests that prove the write service's cleanup really removes the object " +
    "it put when the row write fails, that the per-asset cap holds against committed rows, that " +
    "0072 refuses the service's own values shape stamped with another organization, and that " +
    "remove deletes the object only after the row's transaction committed. Every other " +
    "asset-image write test runs over an in-memory S3Ops and passes with all four broken.",
});

const storageConfig = requireIntegrationStorage({
  item: "F3.4",
  label: "asset image write-path integration tests",
  because:
    "an in-memory S3Ops cannot tell you whether an object is really gone from a bucket. The " +
    "orphan-cleanup, remove and decision-11 rows are measurements of MinIO's state, not of a " +
    "fake's call list (ADR 0066 decisions 4, 11).",
});

describe.skipIf(!connectionString || !storageConfig)(
  "F3.4 — the asset image write path against MinIO and Postgres",
  () => {
    let fleetPool: pg.Pool;
    let tenantPool: pg.Pool;
    let committedAssetIds: string[] = [];
    let fx: AssetImageWriteFixtures;

    beforeAll(async () => {
      const url = connectionString as string;
      const config = storageConfig!;

      fleetPool = await openIntegrationPool(url, "F3.4"); // fleet (BYPASSRLS) by default
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.4",
      );
      const fleetDb = createDb(fleetPool);
      const tenantDb = createDb(tenantPool);

      // Two organizations that each own an active location — the `E7.1b`
      // resolution, on the fleet pool because bms.locations is tenant-policied
      // and the GUC cannot be chosen before the organization is known.
      const orgs = await fleetPool.query<{ id: string }>(
        `SELECT DISTINCT o.id
           FROM bms.organizations o
           JOIN bms.locations l ON l.organization_id = o.id AND l.active = true
          ORDER BY o.id
          LIMIT 2`,
      );
      if (orgs.rows.length < 2) {
        throw new Error("F3.4: need two seeded organizations with an active location — run pnpm db:seed.");
      }
      const orgAId = orgs.rows[0].id;
      const orgBId = orgs.rows[1].id;
      const loc = await fleetPool.query<{ id: string }>(
        `SELECT id FROM bms.locations
           WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [orgAId],
      );
      if (!loc.rows[0]) {
        throw new Error(`F3.4: organization ${orgAId} has no active location — run pnpm db:seed.`);
      }
      const locationA: FixtureLocation = { locationId: loc.rows[0].id, organizationId: orgAId };

      // The actor: a seeded user, read by email, so `created_by` and
      // `audit_log.actor_id` resolve to a real row rather than NULL. `bms.users`
      // is FORCE-policied since `0047`; the fleet pool is BYPASSRLS and the one
      // connection that can see an org-less global admin.
      const actor = await fleetPool.query<{ id: string; email: string; display_name: string; role: string }>(
        `SELECT id, email, display_name, role FROM bms.users WHERE email = $1`,
        ["admin@bms.local"],
      );
      const actorRow = actor.rows[0];
      if (!actorRow) {
        throw new Error("F3.4: the seeded admin@bms.local user is missing — run pnpm db:seed.");
      }
      const jwt: JwtPayload = {
        sub: actorRow.id,
        email: actorRow.email,
        name: actorRow.display_name,
        role: actorRow.role as JwtPayload["role"],
      };

      committedAssetIds = await createFixtureAssets(fleetDb, 2, "f3-4", locationA);

      const client = createStorageClient(config, {
        createOps: () => createAwsS3Ops(config),
        logger: new Logger("F3.4 write integration"),
      });
      await ensureBucket(client);

      fx = {
        config,
        client,
        fleetDb,
        tenantDb,
        orgAId,
        orgBId,
        locationA,
        actor: jwt,
        actorId: actorRow.id,
        assetId: committedAssetIds[0] as string,
        capAssetId: committedAssetIds[1] as string,
      };
    });

    afterAll(async () => {
      if (fleetPool && committedAssetIds.length > 0) {
        // The audit rows first: they reference nothing that cascades, and they
        // are bounded by this run's own fixture asset ids.
        await fleetPool.query(
          `DELETE FROM bms.audit_log
            WHERE entity_type = 'asset_image' AND payload->>'assetId' = ANY($1::text[])`,
          [committedAssetIds],
        );
        // By id, and any surviving image row goes with the asset through
        // ON DELETE CASCADE.
        await createDb(fleetPool).delete(assets).where(inArray(assets.id, committedAssetIds));
      }
      await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
    });

    it("answers the upload with a DTO that carries no objectKey (decision 4)", async () => {
      await assertUploadReturnsADtoWithoutTheObjectKey(fx);
    });

    it("streams the uploaded bytes back out of the content route", async () => {
      await assertContentStreamsTheUploadedBytes(fx);
    });

    it("stores the key buildObjectKey makes of the three ids", async () => {
      await assertTheStoredKeyIsTheBuiltKey(fx);
    });

    it("lists the uploaded image without its object key", async () => {
      await assertTheUploadIsListedWithoutTheObjectKey(fx);
    });

    it("audits the create inside the asset's own organization", async () => {
      await assertTheCreateAuditRowCarriesTheAssetsOrganization(fx);
    });

    it("resolves the audit row's actor to the seeded user", async () => {
      await assertTheCreateAuditRowNamesAnActor(fx);
    });

    it("keeps the filename and the caption out of the audit payload (§9.6)", async () => {
      await assertTheCreateAuditPayloadOmitsTheFilenameAndCaption(fx);
    });

    it("refuses an image row stamped with another organization (0072, SQLSTATE 42501)", async () => {
      await assertAnInsertStampedWithAnotherOrganizationIsRefused(fx);
    });

    it("accepts the same row stamped with the asset's own organization", async () => {
      await assertTheCorrectlyStampedInsertIsAccepted(fx);
    });

    it("answers 409 for the upload past MAX_ASSET_IMAGES_PER_ASSET (R-3)", async () => {
      await assertTheUploadPastTheCapIsAConflict(fx);
    });

    it("leaves exactly the cap behind after the refusal", async () => {
      await assertTheCapLeavesExactlyTwentyRows(fx);
    });

    it("puts no object for the refused upload (the fleet pre-check runs first)", async () => {
      await assertTheRefusedUploadPutNoObject(fx);
    });

    it("rethrows the original error when the row write fails", async () => {
      await assertAFailedRowWriteRejectsWithTheOriginalError(fx);
    });

    it("leaves no image row when the row write fails", async () => {
      await assertAFailedRowWriteLeavesNoRow(fx);
    });

    it("really removes the object it had put when the row write fails (R-2)", async () => {
      await assertAFailedRowWriteRemovesTheObject(fx);
    });

    it("deletes the row on remove", async () => {
      await assertRemoveDeletesTheRow(fx);
    });

    it("audits the delete with the image id", async () => {
      await assertRemoveWritesTheDeleteAuditRow(fx);
    });

    it("deletes the object on remove", async () => {
      await assertRemoveDeletesTheObject(fx);
    });

    it("deletes the object only after the row's transaction committed (decision 11)", async () => {
      await assertRemoveDeletesTheObjectOnlyAfterTheRowIsGone(fx);
    });

    it("resolves when the object delete fails after the row is gone", async () => {
      await assertRemoveResolvesWhenTheObjectDeleteFails(fx);
    });

    it("still deletes the row when the object delete fails", async () => {
      await assertTheRowIsGoneWhenTheObjectDeleteFails(fx);
    });

    it("warns once with the image id when the object delete fails", async () => {
      await assertTheOrphanWarnNamesTheImageIdOnce(fx);
    });

    it("never writes the object key into that warn (§9.6)", async () => {
      await assertTheOrphanWarnNeverNamesTheKey(fx);
    });

    it("leaves the orphan object in the bucket (decision 11)", async () => {
      await assertTheOrphanObjectStaysInTheBucket(fx);
    });
  },
);
