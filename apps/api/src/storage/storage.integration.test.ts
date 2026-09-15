import { S3Client } from "@aws-sdk/client-s3";
import { Logger } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import { createFixtureAssets, type FixtureLocation } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import { createAwsS3Ops } from "./aws-s3-ops";
import { createStorageClient, ensureBucket } from "./storage-client";
import {
  assertACrossOrgPairingIsRefused,
  assertAMissingObjectIsA404,
  assertASameOrgPairingIsAccepted,
  assertAnotherTenantSeesNoRow,
  assertContentHashMatchesTheRow,
  assertContentReturnsTheStoredBytes,
  assertDeletingTheAssetRemovesTheImageRow,
  assertEnsureBucketCreatesAMissingBucket,
  assertEnsureBucketIsIdempotent,
  assertGetObjectMissingIsNoSuchKey404,
  assertGetObjectOnAMissingKeyIsNull,
  assertHeadBucketMissingIsNotFound404,
  assertHeadObjectMissingIsNotFound404,
  assertHeadObjectOnAMissingKeyIsNull,
  assertListNeverCarriesTheObjectKey,
  assertListReturnsTheStoredRow,
  assertTheCascadeRowExistedFirst,
  assertTheMissingObjectWarnNamesTheImageId,
  assertTheListNeverServesAForeignOrganizationsRow,
  assertTheListServesTheOwnOrganizationsRow,
  assertTheMissingObjectWarnNeverNamesTheKey,
  assertTheOwningTenantSeesTheRow,
  assertWrongCredentialsThrowRatherThanReadAsMissing,
  type StorageFixtures,
} from "./storage.integration.spec";

/**
 * `F3.3` — Vitest entry point for the object-storage integration suite.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file owns the
 * two lifecycles, the database's and the bucket's.
 *
 * **Two gates, and they are not interchangeable.** `requireIntegrationDb`
 * decides on `DATABASE_URL`, `requireIntegrationStorage` on
 * `OBJECT_STORAGE_ENDPOINT`; either unset skips locally and refuses in CI, and
 * a set-but-broken value fails in both. `describe.skipIf` takes both, so a
 * machine with a database and no MinIO skips rather than failing.
 *
 * **What is committed and what is not.** One fixture asset in organization A is
 * committed, because the real service resolves its scope on the fleet pool and
 * then reads on a second connection — an uncommitted asset is invisible to
 * both. It is deleted **by id** in `afterAll`: never by a `code LIKE` sweep,
 * which would delete a concurrent instance's fixtures
 * (`tests/integration-fixture-isolation.test.ts`). Everything the policy rows
 * touch is built inside their own rolled-back transaction and shared with
 * nobody.
 *
 * The bucket is ensured once here, as `StorageBootstrap` does at boot, so the
 * rows that put objects do not each race to create it.
 */
const connectionString = requireIntegrationDb({
  item: "F3.3",
  label: "object storage and bms.asset_images integration tests",
  because:
    "these are the only tests that prove the 0072 tenant policy refuses another organization's " +
    "GUC and a cross-organization asset pairing, that ON DELETE CASCADE reaches the image row, " +
    "and that the list route never emits objectKey. Every other asset-image test runs over fakes " +
    "and passes with the policy dropped.",
});

const storageConfig = requireIntegrationStorage({
  item: "F3.3",
  label: "object storage integration tests",
  because:
    "these are the only tests that prove putObject -> row -> content round-trips real bytes " +
    "through a real S3 endpoint, and the only measurement of what the SDK calls a missing object. " +
    "aws-s3-ops.ts's isMissing map is a hypothesis without them (ADR 0066 decision 10).",
});

describe.skipIf(!connectionString || !storageConfig)(
  "F3.3 — object storage and bms.asset_images against MinIO and Postgres",
  () => {
    let fleetPool: pg.Pool;
    let tenantPool: pg.Pool;
    let s3: S3Client;
    let committedAssetIds: string[] = [];
    let fx: StorageFixtures;

    beforeAll(async () => {
      const url = connectionString as string;
      const config = storageConfig!;

      fleetPool = await openIntegrationPool(url, "F3.3"); // fleet (BYPASSRLS) by default
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.3",
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
        throw new Error("F3.3: need two seeded organizations with an active location — run pnpm db:seed.");
      }
      const locationFor = async (organizationId: string): Promise<FixtureLocation> => {
        const loc = await fleetPool.query<{ id: string }>(
          `SELECT id FROM bms.locations
             WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
          [organizationId],
        );
        if (!loc.rows[0]) {
          throw new Error(`F3.3: organization ${organizationId} has no active location — run pnpm db:seed.`);
        }
        return { locationId: loc.rows[0].id, organizationId };
      };
      const orgAId = orgs.rows[0].id;
      const orgBId = orgs.rows[1].id;
      const locationA = await locationFor(orgAId);
      const locationB = await locationFor(orgBId);

      committedAssetIds = await createFixtureAssets(fleetDb, 1, "f3-3", locationA);

      const ops = createAwsS3Ops(config);
      const client = createStorageClient(config, {
        createOps: () => ops,
        logger: new Logger("F3.3 storage integration"),
      });
      await ensureBucket(client);

      s3 = new S3Client({
        endpoint: config.endpoint.toString(),
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });

      fx = {
        config,
        client,
        ops,
        s3,
        fleetDb,
        tenantDb,
        orgAId,
        orgBId,
        locationA,
        locationB,
        committedAssetId: committedAssetIds[0] as string,
      };
    });

    afterAll(async () => {
      if (fleetPool && committedAssetIds.length > 0) {
        // By id, and the image rows go with it through ON DELETE CASCADE — the
        // thing this suite measures, used here as teardown.
        await createDb(fleetPool).delete(assets).where(inArray(assets.id, committedAssetIds));
      }
      s3?.destroy();
      await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
    });

    it("creates the bucket when it is missing (decision 9)", async () => {
      await assertEnsureBucketCreatesAMissingBucket(fx);
    });

    it("creates nothing on a second ensureBucket", async () => {
      await assertEnsureBucketIsIdempotent(fx);
    });

    it("streams back the bytes that were put (decision 10)", async () => {
      await assertContentReturnsTheStoredBytes(fx);
    });

    it("streams back an object whose sha256 is the row's", async () => {
      await assertContentHashMatchesTheRow(fx);
    });

    it("lists the stored row for its asset", async () => {
      await assertListReturnsTheStoredRow(fx);
    });

    it("never puts objectKey on a listed DTO (decision 4)", async () => {
      await assertListNeverCarriesTheObjectKey(fx);
    });

    it("serves the asset's own organization's image row", async () => {
      await assertTheListServesTheOwnOrganizationsRow(fx);
    });

    it("never serves a row stamped with another organization (0072, inside the route)", async () => {
      await assertTheListNeverServesAForeignOrganizationsRow(fx);
    });

    it("answers 404 for a row whose object is gone", async () => {
      await assertAMissingObjectIsA404(fx);
    });

    it("warns with the image id when the object is gone", async () => {
      await assertTheMissingObjectWarnNamesTheImageId(fx);
    });

    it("never writes the object key into that warn", async () => {
      await assertTheMissingObjectWarnNeverNamesTheKey(fx);
    });

    it("hides an image row from another organization's GUC (0072)", async () => {
      await assertAnotherTenantSeesNoRow(fx);
    });

    it("shows the same row to its own organization's GUC", async () => {
      await assertTheOwningTenantSeesTheRow(fx);
    });

    it("refuses an image row whose asset belongs to another organization", async () => {
      await assertACrossOrgPairingIsRefused(fx);
    });

    it("accepts the same insert when the asset is in the same organization", async () => {
      await assertASameOrgPairingIsAccepted(fx);
    });

    it("has an image row before the cascade runs", async () => {
      await assertTheCascadeRowExistedFirst(fx);
    });

    it("cascades an asset delete to its image rows", async () => {
      await assertDeletingTheAssetRemovesTheImageRow(fx);
    });

    it("reads a missing object as null through getObject", async () => {
      await assertGetObjectOnAMissingKeyIsNull(fx);
    });

    it("reads a missing object as null through headObject", async () => {
      await assertHeadObjectOnAMissingKeyIsNull(fx);
    });

    it("measures GetObject on a missing key as NoSuchKey/404", async () => {
      await assertGetObjectMissingIsNoSuchKey404(fx);
    });

    it("measures HeadObject on a missing key as NotFound/404", async () => {
      await assertHeadObjectMissingIsNotFound404(fx);
    });

    it("measures HeadBucket on a missing bucket as NotFound/404", async () => {
      await assertHeadBucketMissingIsNotFound404(fx);
    });

    it("throws on wrong credentials instead of reading the object as missing", async () => {
      await assertWrongCredentialsThrowRatherThanReadAsMissing(fx);
    });
  },
);
