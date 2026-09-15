import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import {
  DeleteBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Logger } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { vi } from "vitest";

import { assetImages, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AssetImagesService } from "../assets/asset-images.service";
import type { BmsTx } from "../database/tenant-context";
import { createFixtureAssets, type FixtureLocation } from "../testing/integration-fixtures";
import { withRollback } from "../testing/with-rollback";
import { createAwsS3Ops } from "./aws-s3-ops";
import { buildObjectKey } from "./object-key";
import type { ConfiguredStorageConfig } from "../testing/integration-storage-gate";
import {
  BUCKET_RACE_NAMES,
  deleteObject,
  ensureBucket,
  getObject,
  putObject,
  type S3Ops,
  type StorageClient,
} from "./storage-client";

/**
 * `F3.3` (ADR 0066 decisions 4, 5, 9, 10; Amendment 1 Q-G) — object storage
 * and `bms.asset_images` against a **real** S3 endpoint and a real database.
 *
 * This is the row the ADR's decision 10 exists for: `putObject → row →
 * GET …/content`, proved end to end, with the bytes read back and hashed. The
 * unit specs prove the seams over fakes — an in-memory `S3Ops` cannot tell you
 * what S3 names a missing object, whether the `0072` policy actually refuses a
 * cross-organization pairing, or whether `ON DELETE CASCADE` reaches the image
 * row. Those four things are what this file measures.
 *
 * **Two connections, two jobs, and the difference is load-bearing.**
 * `bms_fleet` is `BYPASSRLS`: it is the fixture and counting connection, and it
 * proves nothing about the policy. Every RLS claim runs on a real `bms_tenant`
 * connection with `app.current_organization` set by `set_config(…, true)`, which
 * is the only role the `0072` policy binds the way a request does.
 *
 * **Isolation, in two shapes, because the subject forces both.**
 *
 * - The policy, the cascade and the cross-organization refusal run inside
 *   `withRollback` on the tenant connection, with their fixture assets built by
 *   `createFixtureAssets` **inside the same transaction** — nothing is shared,
 *   nothing is committed, nothing leaks.
 * - The round trip cannot. `AssetImagesService` reads through
 *   `withReadScope(tenantDb, fleetDb, …)`, which resolves the organization on
 *   the **fleet pool** and then opens its **own** transaction on the tenant
 *   pool. Neither connection can see an uncommitted fixture, so driving the
 *   real service against an uncommitted row would resolve an empty scope and
 *   404 for the wrong reason — a green row that proved nothing. The round-trip
 *   and missing-object rows therefore commit their asset and their image row,
 *   and delete both **by id** (never by a code prefix — a shared prefix sweep is
 *   what `tests/integration-fixture-isolation.test.ts` refuses) in `finally`.
 *   The plan's Unit 7 said "fixture assets inside the rollback transaction" for
 *   these rows; that is a plan defect, recorded here rather than worked around
 *   silently.
 *
 * **Objects are deleted in `finally`, per row.** A per-run key prefix is not
 * possible: a key is `buildObjectKey`'s `organizationId/assetId/imageId` triple
 * and nothing else (decision 4), so there is no prefix to sweep at the end and
 * this suite's teardown lists nothing. Every row that puts an object removes it
 * on the way out, whatever the assertion did.
 *
 * **The SDK error names are MEASURED here**, which is what turns
 * `aws-s3-ops.ts`'s `isMissing` map from a hypothesis into a fact. Against
 * MinIO `RELEASE.2025-09-07T16-13-09Z`: `GetObject` on a missing key answers
 * `NoSuchKey` (404), `HeadObject` on a missing key answers `NotFound` (404, and
 * no `Code` — a bodiless HEAD response), and `HeadBucket` on a missing bucket
 * answers `NotFound` (404).
 *
 * The last row is the negative that keeps that map honest: a client with wrong
 * credentials must **throw** on `getObject`, not report the object missing. A
 * map that treated every error as "missing" would turn an authentication
 * failure into an empty list and a 404, and no unit test can catch it — Unit
 * 6's transport-error rows drive an in-memory fake and never reach this file.
 */

/** Everything the assertions need. Built once by the `.test.ts` lifecycle. */
export type StorageFixtures = {
  readonly config: ConfiguredStorageConfig;
  /** The configured client, bound to the configured bucket, over the real SDK. */
  readonly client: StorageClient;
  /** The same ops, unbound, for the bucket-level rows. */
  readonly ops: S3Ops;
  /** The raw SDK client — only the error-name measurements use it. */
  readonly s3: S3Client;
  readonly fleetDb: BmsDb;
  readonly tenantDb: BmsDb;
  readonly orgAId: string;
  readonly orgBId: string;
  readonly locationA: FixtureLocation;
  readonly locationB: FixtureLocation;
  /** A committed fixture asset in organization A, deleted by id in `afterAll`. */
  readonly committedAssetId: string;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** Captures a rejection. A call that resolves fails here, never inside a `catch`. */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let resolved = false;
  let thrown: unknown;
  try {
    await run();
    resolved = true;
  } catch (err) {
    thrown = err;
  }
  if (resolved) {
    throw new Error("expected the call to reject, but it resolved");
  }
  return thrown;
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : String(err);
}

/**
 * The SQLSTATE of a database rejection, dug out of the error **and its cause**.
 *
 * Drizzle wraps the `pg` error, so `err.code` alone is `undefined` on some
 * paths. The code is the only thing worth asserting on: RLS deliberately
 * suppresses the detail of what it refused, so the message says nothing
 * specific to this policy.
 */
function sqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Runs `fn` with `Logger.prototype.warn` captured; restores the spy whatever happens. */
async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const warns: string[] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  try {
    return { result: await fn(), warns };
  } finally {
    spy.mockRestore();
  }
}

function setTenant(tx: BmsTx, organizationId: string): Promise<unknown> {
  return tx.execute(sql`select set_config('app.current_organization', ${organizationId}, true)`);
}

async function countImages(tx: BmsTx, imageId: string): Promise<number> {
  const result = await tx.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.asset_images where id = ${imageId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

/** The image-row values every row inserts, minus the ids the caller chooses. */
function imageValues(input: {
  id: string;
  organizationId: string;
  assetId: string;
  objectKey: string;
  bytes: Buffer;
}): typeof assetImages.$inferInsert {
  return {
    id: input.id,
    organizationId: input.organizationId,
    assetId: input.assetId,
    objectKey: input.objectKey,
    contentType: "image/png",
    byteSize: input.bytes.length,
    sha256: sha256Of(input.bytes),
    originalFilename: "pump-nameplate.png",
    caption: null,
    createdBy: null,
  };
}

// ---------------------------------------------------------------------------
// Row 1 — `ensureBucket` against a real endpoint
// ---------------------------------------------------------------------------

type EnsureRun = { readonly calls: string[]; readonly firstVerdict: string };

/**
 * Drives `ensureBucket` twice against a bucket that does **not** exist yet, so
 * both halves of decision 9 are measured: the create path, and the second call
 * that must create nothing. A scratch bucket rather than the configured one —
 * against the configured bucket the first call would already find `"ok"` and
 * the create path would never run.
 *
 * The recorder wraps the real ops, so the call list is what reached the wire.
 * The bucket is removed in `finally`.
 */
async function runEnsureBucketTwice(fx: StorageFixtures): Promise<EnsureRun> {
  const bucket = `bms-f3-3-scratch-${randomUUID()}`;
  const calls: string[] = [];
  let firstVerdict = "";
  const recorded: S3Ops = {
    headBucket: async (b) => {
      const verdict = await fx.ops.headBucket(b);
      calls.push(`headBucket:${verdict}`);
      if (firstVerdict === "") {
        firstVerdict = verdict;
      }
      return verdict;
    },
    createBucket: async (b) => {
      calls.push("createBucket");
      await fx.ops.createBucket(b);
    },
    putObject: fx.ops.putObject,
    getObject: fx.ops.getObject,
    headObject: fx.ops.headObject,
    deleteObject: fx.ops.deleteObject,
  };
  const client: StorageClient = { kind: "configured", bucket, ops: recorded };
  try {
    await ensureBucket(client);
    await ensureBucket(client);
    return { calls, firstVerdict };
  } finally {
    await fx.s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  }
}

/** Decision 9: a missing bucket is created — the boot path, on a real endpoint. */
export async function assertEnsureBucketCreatesAMissingBucket(fx: StorageFixtures): Promise<void> {
  const run = await runEnsureBucketTwice(fx);
  assert(
    run.firstVerdict === "missing",
    `headBucket on an absent bucket must answer "missing"; got "${run.firstVerdict}" — the ` +
      "SDK's 404 mapping in aws-s3-ops.ts is what this measures",
  );
  assert(
    run.calls.filter((c) => c === "createBucket").length === 1,
    `the first ensureBucket must create the bucket exactly once; calls: ${run.calls.join(", ")}`,
  );
}

/**
 * The lost-race name, MEASURED (review finding C, 2026-09-15). `ensureBucket`
 * treats `BucketAlreadyOwnedByYou` and `BucketAlreadyExists` from
 * `createBucket` as success, and until this row those two names were asserted
 * only against an in-memory fake. Here the real ops create the bucket that
 * `beforeAll` already ensured — the exact call the second replica makes when
 * it loses the race — and the outcome must be one of the two names or a
 * resolution (MinIO can answer a same-owner re-create with 200). Anything
 * else is a name the boot path would rethrow, and this row says which.
 */
export async function assertCreateBucketOnAnExistingBucketIsALostRace(fx: StorageFixtures): Promise<void> {
  let resolved = false;
  let thrown: unknown;
  try {
    await fx.ops.createBucket(fx.config.bucket);
    resolved = true;
  } catch (err) {
    thrown = err;
  }
  assert(
    resolved || BUCKET_RACE_NAMES.has(errorName(thrown)),
    `CreateBucket on an existing bucket must resolve or reject with one of ` +
      `${[...BUCKET_RACE_NAMES].join("/")}; it rejected with ${errorName(thrown)} — ` +
      "ensureBucket would rethrow that and refuse the boot of a second replica",
  );
}

/** Decision 9: idempotent — the second call heads the bucket and creates nothing. */
export async function assertEnsureBucketIsIdempotent(fx: StorageFixtures): Promise<void> {
  const run = await runEnsureBucketTwice(fx);
  const created = run.calls.indexOf("createBucket");
  // The control for this run's own call list. Without it `indexOf` answers -1
  // when the create path never fired, `slice(0)` takes the whole list, and both
  // assertions below hold for a run that proved nothing.
  assert(
    created >= 0,
    `the create path must have run before idempotence means anything; calls: ${run.calls.join(", ")}`,
  );
  const second = run.calls.slice(created + 1);
  assert(
    !second.includes("createBucket"),
    `the second ensureBucket must create nothing; calls after the first create: ${second.join(", ")}`,
  );
  assert(
    second.includes("headBucket:ok"),
    `the second ensureBucket must head the bucket and read "ok"; calls: ${run.calls.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Rows 2 and 3 — the round trip, and a row whose object is gone
// ---------------------------------------------------------------------------

type RoundTrip = {
  readonly imageId: string;
  readonly bytes: Buffer;
  readonly fetched: Buffer;
  readonly row: Awaited<ReturnType<AssetImagesService["content"]>>["row"];
  readonly listed: Awaited<ReturnType<AssetImagesService["list"]>>;
};

/**
 * Commits one image row on the committed fixture asset, puts its object, and
 * drives the **real** service for both routes. Row and object are removed in
 * `finally`, by id and by key.
 */
async function runRoundTrip(fx: StorageFixtures): Promise<RoundTrip> {
  const imageId = randomUUID();
  const bytes = Buffer.from(`f3-3-png-bytes-${imageId}`, "utf8");
  const objectKey = buildObjectKey({
    organizationId: fx.orgAId,
    assetId: fx.committedAssetId,
    imageId,
  });

  await putObject(fx.client, objectKey, bytes, "image/png");
  try {
    await fx.fleetDb.insert(assetImages).values(
      imageValues({ id: imageId, organizationId: fx.orgAId, assetId: fx.committedAssetId, objectKey, bytes }),
    );
    const service = new AssetImagesService(fx.tenantDb, fx.fleetDb, fx.client);
    const content = await service.content(fx.committedAssetId, imageId);
    const fetched = await collect(content.body);
    const listed = await service.list(fx.committedAssetId);
    return { imageId, bytes, fetched, row: content.row, listed };
  } finally {
    // Both teardowns run whatever the other does (post-merge sweep,
    // 2026-09-15): sequenced, a DB delete that threw skipped the object
    // delete and the docblock's "every row that puts an object removes it on
    // the way out" was false. The DB failure is still rethrown; the object
    // delete's is swallowed as before.
    const [dbDelete] = await Promise.allSettled([
      fx.fleetDb.delete(assetImages).where(eq(assetImages.id, imageId)),
      deleteObject(fx.client, objectKey),
    ]);
    if (dbDelete.status === "rejected") {
      throw dbDelete.reason;
    }
  }
}

/** Decision 10: the bytes that come back out of `…/content` are the bytes that went in. */
export async function assertContentReturnsTheStoredBytes(fx: StorageFixtures): Promise<void> {
  const run = await runRoundTrip(fx);
  assert(
    run.fetched.equals(run.bytes),
    `the streamed body must equal the stored bytes; got ${run.fetched.length} of ${run.bytes.length} bytes`,
  );
}

/** The row's `sha256` is the digest of the object the bucket actually holds. */
export async function assertContentHashMatchesTheRow(fx: StorageFixtures): Promise<void> {
  const run = await runRoundTrip(fx);
  assert(
    sha256Of(run.fetched) === run.row.sha256,
    `the fetched object's sha256 must equal the row's; row ${run.row.sha256}, fetched ${sha256Of(run.fetched)}`,
  );
}

/** Decision 4: the list route answers the row, addressed by its id. */
export async function assertListReturnsTheStoredRow(fx: StorageFixtures): Promise<void> {
  const run = await runRoundTrip(fx);
  assert(run.listed.length === 1, `expected exactly one image, got ${run.listed.length}`);
  assert(
    run.listed[0]?.id === run.imageId,
    `the listed image must be the stored one; got ${String(run.listed[0]?.id)}`,
  );
}

/**
 * Decision 4: `objectKey` never leaves the service. Asserted as an **own
 * property** check on the real DTO the real service built from a real row —
 * the contract spec proves the schema refuses the key, this proves the value
 * never carries it.
 */
export async function assertListNeverCarriesTheObjectKey(fx: StorageFixtures): Promise<void> {
  const run = await runRoundTrip(fx);
  const dto = run.listed[0] as Record<string, unknown> | undefined;
  assert(dto !== undefined, "the positive control failed: the list returned no row at all");
  assert(
    dto !== undefined && !Object.hasOwn(dto, "objectKey"),
    `the DTO must not carry objectKey; keys: ${Object.keys(dto ?? {}).join(", ")}`,
  );
}

type ScopedListRun = {
  readonly ownId: string;
  readonly foreignId: string;
  readonly listed: Awaited<ReturnType<AssetImagesService["list"]>>;
};

/**
 * Commits two image rows on the **same** organization-A asset: one stamped
 * organization A, one stamped organization B, the second written on the
 * `bms_fleet` connection because `BYPASSRLS` is the only way such a row can
 * exist at all — the `0072` `WITH CHECK` refuses it on a tenant connection
 * (the row above measures that). Then it drives the real list route.
 *
 * This is the row that proves the **service** reads under the request's
 * tenant, not merely that the policy exists: `withReadScope` resolves the
 * asset's organization on the fleet pool and runs the read inside
 * `withTenant`, so the mis-stamped row is filtered by the policy. A `list`
 * that read on `fleetDb` — the one-line mistake `fleet-read-wiring.spec.ts`
 * exists to catch in the constructor — returns both rows and reddens here,
 * while every other row in this file still passes.
 */
async function runScopedList(fx: StorageFixtures): Promise<ScopedListRun> {
  const ownId = randomUUID();
  const foreignId = randomUUID();
  const bytes = Buffer.from("scope-probe", "utf8");
  const values = (id: string, organizationId: string): typeof assetImages.$inferInsert =>
    imageValues({
      id,
      organizationId,
      assetId: fx.committedAssetId,
      objectKey: buildObjectKey({ organizationId, assetId: fx.committedAssetId, imageId: id }),
      bytes,
    });

  await fx.fleetDb.insert(assetImages).values(values(ownId, fx.orgAId));
  await fx.fleetDb.insert(assetImages).values(values(foreignId, fx.orgBId));
  try {
    const service = new AssetImagesService(fx.tenantDb, fx.fleetDb, fx.client);
    return { ownId, foreignId, listed: await service.list(fx.committedAssetId) };
  } finally {
    await fx.fleetDb.delete(assetImages).where(inArray(assetImages.id, [ownId, foreignId]));
  }
}

/** The positive control: the correctly-stamped row is served. */
export async function assertTheListServesTheOwnOrganizationsRow(fx: StorageFixtures): Promise<void> {
  const run = await runScopedList(fx);
  assert(
    run.listed.some((image) => image.id === run.ownId),
    `the list must serve the row stamped with the asset's own organization; got ` +
      `${run.listed.map((i) => i.id).join(", ")}`,
  );
}

/** …and the mis-stamped one is filtered by the `0072` policy, inside the route. */
export async function assertTheListNeverServesAForeignOrganizationsRow(
  fx: StorageFixtures,
): Promise<void> {
  const run = await runScopedList(fx);
  assert(
    !run.listed.some((image) => image.id === run.foreignId),
    "the list route must not serve a row stamped with another organization — the read has to " +
      "run under withTenant on the tenant pool, not on bms_fleet",
  );
}

type MissingObjectRun = { readonly imageId: string; readonly err: unknown; readonly warns: string[] };

/** Commits a row whose object was never put, then drives `content`. */
async function runMissingObject(fx: StorageFixtures): Promise<MissingObjectRun> {
  const imageId = randomUUID();
  const bytes = Buffer.from("never-uploaded", "utf8");
  const objectKey = buildObjectKey({
    organizationId: fx.orgAId,
    assetId: fx.committedAssetId,
    imageId,
  });
  await fx.fleetDb.insert(assetImages).values(
    imageValues({ id: imageId, organizationId: fx.orgAId, assetId: fx.committedAssetId, objectKey, bytes }),
  );
  try {
    const service = new AssetImagesService(fx.tenantDb, fx.fleetDb, fx.client);
    const { result: err, warns } = await capturingWarns(() =>
      captureRejection(() => service.content(fx.committedAssetId, imageId)),
    );
    return { imageId, err, warns };
  } finally {
    await fx.fleetDb.delete(assetImages).where(eq(assetImages.id, imageId));
  }
}

/** Decision 4: a row with no object is a 404, not a 500 and not an empty 200. */
export async function assertAMissingObjectIsA404(fx: StorageFixtures): Promise<void> {
  const run = await runMissingObject(fx);
  assert(
    errorName(run.err) === "NotFoundException",
    `a row whose object is absent must be a NotFoundException; got ${errorName(run.err)}`,
  );
}

/** The warn names the image id — the id is what an operator can act on. */
export async function assertTheMissingObjectWarnNamesTheImageId(fx: StorageFixtures): Promise<void> {
  const run = await runMissingObject(fx);
  assert(run.warns.length === 1, `expected one warn, saw ${run.warns.length}: ${run.warns.join(" | ")}`);
  assert(
    run.warns[0]?.includes(run.imageId) === true,
    `the warn must name the image id; got: ${String(run.warns[0])}`,
  );
}

/**
 * …and never the key (§9.6, decision 4). The key contains the organization id
 * and the asset id; a log line carrying it hands a reader the bucket layout.
 */
export async function assertTheMissingObjectWarnNeverNamesTheKey(fx: StorageFixtures): Promise<void> {
  const run = await runMissingObject(fx);
  const joined = run.warns.join("\n");
  assert(
    !joined.includes(fx.committedAssetId) && !joined.includes(fx.orgAId),
    `the warn must not carry the object key's parts; got: ${joined}`,
  );
}

// ---------------------------------------------------------------------------
// Rows 4, 5 and 6 — the `0072` policy, on a real `bms_tenant` connection
// ---------------------------------------------------------------------------

type RlsRun = { readonly asOwner: number; readonly asOther: number };

/**
 * One `bms_tenant` transaction: build an asset in organization A and one in
 * organization B, insert an image row for A's asset, then count that row under
 * B's GUC and under A's. `bms_fleet` would answer 1 to both — it is
 * `BYPASSRLS` — so the count must run on this connection to mean anything.
 */
async function runTenantVisibility(fx: StorageFixtures): Promise<RlsRun> {
  let asOwner = -1;
  let asOther = -1;
  await withRollback(fx.tenantDb, async (tx) => {
    await setTenant(tx, fx.orgAId);
    const [assetAId] = await createFixtureAssets(tx, 1, "f3-3", fx.locationA);
    const imageId = randomUUID();
    const bytes = Buffer.from("rls-probe", "utf8");
    await tx.insert(assetImages).values(
      imageValues({
        id: imageId,
        organizationId: fx.orgAId,
        assetId: assetAId as string,
        objectKey: buildObjectKey({ organizationId: fx.orgAId, assetId: assetAId as string, imageId }),
        bytes,
      }),
    );

    await setTenant(tx, fx.orgBId);
    asOther = await countImages(tx, imageId);

    await setTenant(tx, fx.orgAId);
    asOwner = await countImages(tx, imageId);

    await tx.rollback();
  });
  return { asOwner, asOther };
}

/** `0072`: another organization's GUC sees none of this row. */
export async function assertAnotherTenantSeesNoRow(fx: StorageFixtures): Promise<void> {
  const run = await runTenantVisibility(fx);
  assert(
    run.asOther === 0,
    `organization B must see 0 rows under the 0072 policy; saw ${run.asOther}`,
  );
}

/**
 * The adjacent positive control. Without it, "B sees 0" passes when the insert
 * never happened, when the count query is wrong, and when the policy refuses
 * everyone — an absence assertion proves nothing on its own.
 */
export async function assertTheOwningTenantSeesTheRow(fx: StorageFixtures): Promise<void> {
  const run = await runTenantVisibility(fx);
  assert(
    run.asOwner === 1,
    `organization A must see its own row; saw ${run.asOwner} — the zero above would then mean nothing`,
  );
}

type ParentCheckRun = { readonly crossOrg: unknown; readonly sameOrg: number };

/**
 * The policy's `EXISTS` leg, measured. Under organization A's GUC, insert an
 * image row stamped `organization_id = A` whose `asset_id` belongs to
 * organization B — the own-column check passes and only the parent check can
 * refuse it. The same transaction then inserts a legitimate pairing, so a
 * refusal that came from something else (a grant, a CHECK) is visible.
 */
async function runParentCheck(fx: StorageFixtures): Promise<ParentCheckRun> {
  let crossOrg: unknown;
  let sameOrg = -1;
  await withRollback(fx.tenantDb, async (tx) => {
    await setTenant(tx, fx.orgBId);
    const [assetBId] = await createFixtureAssets(tx, 1, "f3-3", fx.locationB);

    await setTenant(tx, fx.orgAId);
    const [assetAId] = await createFixtureAssets(tx, 1, "f3-3", fx.locationA);

    const bytes = Buffer.from("parent-check", "utf8");
    const crossId = randomUUID();
    // **Inside a nested transaction, which is a SAVEPOINT.** A failed statement
    // puts the whole transaction in the aborted state, so the positive control
    // below would fail with `25P02` and say nothing about the policy. The
    // savepoint takes the abort instead, and the outer transaction survives it.
    crossOrg = await captureRejection(() =>
      tx.transaction((inner) =>
        inner.insert(assetImages).values(
          imageValues({
            id: crossId,
            organizationId: fx.orgAId,
            assetId: assetBId as string,
            objectKey: buildObjectKey({
              organizationId: fx.orgAId,
              assetId: assetBId as string,
              imageId: crossId,
            }),
            bytes,
          }),
        ),
      ),
    );

    const sameId = randomUUID();
    await tx.insert(assetImages).values(
      imageValues({
        id: sameId,
        organizationId: fx.orgAId,
        assetId: assetAId as string,
        objectKey: buildObjectKey({ organizationId: fx.orgAId, assetId: assetAId as string, imageId: sameId }),
        bytes,
      }),
    );
    sameOrg = await countImages(tx, sameId);

    await tx.rollback();
  });
  return { crossOrg, sameOrg };
}

/**
 * `42501` — `insufficient_privilege`, what Postgres answers a `WITH CHECK`
 * violation with. The **code**, never the message: RLS suppresses the detail of
 * what it refused.
 */
export async function assertACrossOrgPairingIsRefused(fx: StorageFixtures): Promise<void> {
  const run = await runParentCheck(fx);
  const state = sqlState(run.crossOrg);
  assert(
    state === "42501",
    `a row stamped organization A on organization B's asset must be refused with SQLSTATE 42501; ` +
      `got ${String(state)} (${errorName(run.crossOrg)})`,
  );
}

/** The positive control: the same insert with a same-organization asset lands. */
export async function assertASameOrgPairingIsAccepted(fx: StorageFixtures): Promise<void> {
  const run = await runParentCheck(fx);
  assert(
    run.sameOrg === 1,
    `a same-organization pairing must be accepted; saw ${run.sameOrg} rows — the refusal above ` +
      "would otherwise be consistent with the policy refusing everything",
  );
}

type CascadeRun = { readonly before: number; readonly after: number };

/** `ON DELETE CASCADE` on `asset_id`, measured through a real delete. */
async function runCascade(fx: StorageFixtures): Promise<CascadeRun> {
  let before = -1;
  let after = -1;
  await withRollback(fx.tenantDb, async (tx) => {
    await setTenant(tx, fx.orgAId);
    const [assetId] = await createFixtureAssets(tx, 1, "f3-3", fx.locationA);
    const imageId = randomUUID();
    await tx.insert(assetImages).values(
      imageValues({
        id: imageId,
        organizationId: fx.orgAId,
        assetId: assetId as string,
        objectKey: buildObjectKey({ organizationId: fx.orgAId, assetId: assetId as string, imageId }),
        bytes: Buffer.from("cascade", "utf8"),
      }),
    );
    before = await countImages(tx, imageId);

    await tx.delete(assets).where(eq(assets.id, assetId as string));
    after = await countImages(tx, imageId);

    await tx.rollback();
  });
  return { before, after };
}

/** The positive control for the cascade: the row was there to begin with. */
export async function assertTheCascadeRowExistedFirst(fx: StorageFixtures): Promise<void> {
  const run = await runCascade(fx);
  assert(run.before === 1, `the image row must exist before the asset is deleted; saw ${run.before}`);
}

/** Decision 5: deleting the asset takes its image rows with it. */
export async function assertDeletingTheAssetRemovesTheImageRow(fx: StorageFixtures): Promise<void> {
  const run = await runCascade(fx);
  assert(run.after === 0, `deleting the asset must cascade to bms.asset_images; saw ${run.after}`);
}

// ---------------------------------------------------------------------------
// Row 7 — what S3 actually calls "missing", and row 8 — what it must not
// ---------------------------------------------------------------------------

/** A key in the configured bucket that nothing ever wrote. Built the one legal way. */
function randomKey(fx: StorageFixtures): string {
  return buildObjectKey({
    organizationId: fx.orgAId,
    assetId: randomUUID(),
    imageId: randomUUID(),
  });
}

/** `getObject` on an absent key answers `null` — the mapping, end to end. */
export async function assertGetObjectOnAMissingKeyIsNull(fx: StorageFixtures): Promise<void> {
  const result = await getObject(fx.client, randomKey(fx));
  assert(result === null, `getObject on an absent key must answer null; got ${typeof result}`);
}

/** `headObject` likewise — a different SDK error name, the same verdict. */
export async function assertHeadObjectOnAMissingKeyIsNull(fx: StorageFixtures): Promise<void> {
  const result = await fx.ops.headObject(fx.config.bucket, randomKey(fx));
  assert(result === null, `headObject on an absent key must answer null; got ${typeof result}`);
}

/**
 * The names themselves, from the raw SDK, because the map above swallows them:
 * a row that only asserts `null` cannot tell you whether `isMissing` matched
 * the name or the `404` arm, and the docblock in `aws-s3-ops.ts` states both.
 */
export async function assertGetObjectMissingIsNoSuchKey404(fx: StorageFixtures): Promise<void> {
  const err = await captureRejection(() =>
    fx.s3.send(new GetObjectCommand({ Bucket: fx.config.bucket, Key: randomKey(fx) })),
  );
  assert(
    errorName(err) === "NoSuchKey",
    `GetObject on an absent key must be named NoSuchKey; got ${errorName(err)}`,
  );
  assert(
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404,
    `…and carry a 404; got ${String((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)}`,
  );
}

/** `HeadObject` is a bodiless response, so the SDK names it `NotFound`, not `NoSuchKey`. */
export async function assertHeadObjectMissingIsNotFound404(fx: StorageFixtures): Promise<void> {
  const err = await captureRejection(() =>
    fx.s3.send(new HeadObjectCommand({ Bucket: fx.config.bucket, Key: randomKey(fx) })),
  );
  assert(
    errorName(err) === "NotFound",
    `HeadObject on an absent key must be named NotFound; got ${errorName(err)}`,
  );
  assert(
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404,
    `…and carry a 404; got ${String((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)}`,
  );
}

/** The bucket-level name decision 9's create path depends on. */
export async function assertHeadBucketMissingIsNotFound404(fx: StorageFixtures): Promise<void> {
  const err = await captureRejection(() =>
    fx.s3.send(new HeadBucketCommand({ Bucket: `bms-f3-3-absent-${randomUUID()}` })),
  );
  assert(
    errorName(err) === "NotFound",
    `HeadBucket on an absent bucket must be named NotFound; got ${errorName(err)}`,
  );
  assert(
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404,
    `…and carry a 404; got ${String((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)}`,
  );
}

/**
 * Row 8 — the negative that bounds the map, added because nothing else does.
 *
 * `isMissing` decides between "no such object" and "something went wrong", and
 * every other row here is on the missing side. Widen it to "any error is
 * missing" and every row above still passes: `getObject` keeps answering
 * `null`, the service keeps 404-ing, and an authentication failure — a rotated
 * secret, a mis-set `OBJECT_STORAGE_SECRET_KEY` — is reported to the operator
 * as an image that does not exist. Unit 6's transport-error rows cannot catch
 * it: they drive an in-memory `S3Ops` fake and never reach `aws-s3-ops.ts`.
 *
 * MinIO answers a bad signature `SignatureDoesNotMatch` / 403.
 */
export async function assertWrongCredentialsThrowRatherThanReadAsMissing(
  fx: StorageFixtures,
): Promise<void> {
  const ops = createAwsS3Ops({ ...fx.config, secretAccessKey: `${fx.config.secretAccessKey}-wrong` });
  const err = await captureRejection(() => ops.getObject(fx.config.bucket, randomKey(fx)));
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  assert(
    status === 403,
    `a wrong-credentials getObject must fail with 403, not be read as a missing object; got ` +
      `${String(status)} (${errorName(err)})`,
  );
}
