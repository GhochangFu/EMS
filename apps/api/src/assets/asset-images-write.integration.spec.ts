import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { vi } from "vitest";

import { assetImages } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { MAX_ASSET_IMAGES_PER_ASSET } from "@bms/shared";
import type { AssetImageDto, JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { BmsTx } from "../database/tenant-context";
import { buildObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import { deleteObject, getObject, headObject, type S3Ops, type StorageClient } from "../storage/storage-client";
import type { ConfiguredStorageConfig } from "../testing/integration-storage-gate";
import { createFixtureAssets, type FixtureLocation } from "../testing/integration-fixtures";
import { withRollback } from "../testing/with-rollback";
import { AssetImagesService } from "./asset-images.service";
import { AssetImagesWriteService } from "./asset-images-write.service";

/**
 * `F3.4` (ADR 0066 decisions 4, 7, 11; Amendment 3 R-2, R-3, R-6) — the
 * **write** path against a real S3 endpoint and a real database.
 *
 * `asset-images-write.service.spec.ts` drives the same service over fakes and
 * proves the seams. What a fake cannot tell you is whether the object the
 * service says it cleaned up is really gone from the bucket, whether the
 * `0072` policy refuses the exact `values` shape the service inserts when it
 * carries another organization's id, whether the count cap holds against rows
 * that are really committed, and whether `remove` deletes the object only
 * **after** the row's transaction committed. Those four things are what this
 * file measures; every one of them passes over an in-memory `S3Ops`.
 *
 * **Two connections, two jobs.** `bms_fleet` is `BYPASSRLS`: it is the fixture,
 * counting and teardown connection and it proves nothing about the policy.
 * Every count in this file is read on it and **scoped to this suite's own
 * fixture asset ids** — `bms_owner` would answer 0 with the rows present
 * (`FORCE ROW LEVEL SECURITY`), and a fleet-wide count would also see another
 * suite's committed rows. The service's own writes run through
 * `withTenant(tenantDb, …)` on a real `bms_tenant` connection, which is the
 * only role the `0072` `WITH CHECK` binds the way a request does.
 *
 * **Isolation, in two shapes, because the subject forces both.**
 *
 * - The RLS refusal runs inside `withRollback` on the tenant connection with
 *   its fixture asset built by `createFixtureAssets` **inside the same
 *   transaction** — nothing shared, nothing committed, and the case ends with
 *   `tx.rollback()` (a case that simply returns COMMITS —
 *   `tests/f3.60-withrollback-cases-roll-back.test.ts`).
 * - Every other row drives the real service, which opens its own transactions
 *   on its own pools and cannot see an uncommitted fixture. Those rows use the
 *   three committed fixture assets the `.test.ts` creates and deletes **by
 *   id** in `afterAll`; each row deletes its own image rows and its own
 *   objects in `finally`, whatever the assertion did.
 *
 * **A real PNG, not a text buffer.** R-1's sniff reads the eight signature
 * bytes, so the bytes have to be a real image; `PNG_BYTES` is a 67-byte 1x1
 * RGBA PNG whose three chunk CRCs were verified against `zlib.crc32`.
 *
 * **The cap row commits 20 rows.** That is the only way to reach the
 * authoritative count inside the tenant transaction, and it is why the cap has
 * a fixture asset of its own: a leftover from a previous scenario would turn
 * the 21st upload's 409 into a refusal that proves nothing about the cap.
 */

/** Everything the assertions need. Built once by the `.test.ts` lifecycle. */
export type AssetImageWriteFixtures = {
  readonly config: ConfiguredStorageConfig;
  /** The real configured client over `createAwsS3Ops`, bound to the configured bucket. */
  readonly client: StorageClient;
  readonly fleetDb: BmsDb;
  readonly tenantDb: BmsDb;
  readonly orgAId: string;
  readonly orgBId: string;
  readonly locationA: FixtureLocation;
  /** A seeded user, so `created_by` and `audit_log.actor_id` resolve to a real row. */
  readonly actor: JwtPayload;
  readonly actorId: string;
  /** A committed fixture asset in organization A, deleted by id in `afterAll`. */
  readonly assetId: string;
  /** A second one, used by the cap row alone. */
  readonly capAssetId: string;
  /**
   * A third, in the **same** organization and location as `assetId` — the one
   * the cross-asset refusal row uploads to. It cannot be `capAssetId`: a row
   * this suite failed to clean up there would turn the cap row's 21st upload
   * into a 409 raised by 21 rows rather than by the cap.
   */
  readonly foreignAssetId: string;
};

/**
 * A 1x1 RGBA PNG — 67 bytes, signature + IHDR + IDAT + IEND, every chunk CRC
 * verified with `zlib.crc32` (2026-09-16). The sniff needs real bytes, and the
 * object round-trip needs bytes worth hashing.
 */
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c63000100000500010d0a2db4000000" +
    "0049454e44ae426082",
  "hex",
);

const PNG_FILENAME = "pump-nameplate.png";
const PNG_CAPTION = "Pump 1 nameplate";

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
 * The SQLSTATE of a database rejection, dug out of the error **and its cause**
 * (the `storage.integration.spec.ts` helper). RLS suppresses the detail of
 * what it refused, so the code is the only thing worth asserting on.
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

/** Rows for one asset, read as `bms_fleet` and scoped to that asset alone. */
async function countImagesForAsset(db: BmsDb | BmsTx, assetId: string): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.asset_images where asset_id = ${assetId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

/** One image row, by id. Used as the ordering witness and as the row-gone check. */
async function countImageRow(db: BmsDb | BmsTx, imageId: string): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.asset_images where id = ${imageId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

/** The stored key, read on the fleet pool — the service never returns it. */
async function readObjectKey(db: BmsDb, imageId: string): Promise<string | null> {
  const result = await db.execute<{ object_key: string }>(
    sql`select object_key from bms.asset_images where id = ${imageId}::uuid`,
  );
  return result.rows[0]?.object_key ?? null;
}

type AuditRow = {
  readonly action: string;
  readonly entity_id: string | null;
  readonly organization_id: string | null;
  readonly actor_id: string | null;
  readonly payload: Record<string, unknown> | null;
};

/** Audit rows for one image id and one action, read as `bms_fleet`. */
async function readAuditRows(db: BmsDb, imageId: string, action: string): Promise<AuditRow[]> {
  const result = await db.execute<AuditRow>(
    sql`select action,
               entity_id::text as entity_id,
               organization_id::text as organization_id,
               actor_id::text as actor_id,
               payload
          from bms.audit_log
         where entity_type = 'asset_image'
           and entity_id = ${imageId}::uuid
           and action = ${action}`,
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// The recording client, and the two probe failures
// ---------------------------------------------------------------------------

/** What the probe wrapper makes `deleteObject` throw. A name, so §9.6 holds. */
class DeleteProbeError extends Error {
  override readonly name = "DeleteProbeError";
}

/** What the probe wrapper makes `MasterDataAuditService.write` throw. */
class AuditProbeError extends Error {
  override readonly name = "AuditProbeError";
}

type StorageRecorder = {
  /** The client to hand the service: the real ops, wrapped. */
  readonly client: StorageClient;
  /** Operation names in call order — read as a delta, never as a lifetime count. */
  readonly calls: string[];
  readonly putKeys: string[];
  readonly deleteKeys: string[];
  /** Flipped by the decision-11 row after the upload, so the put still lands. */
  readonly state: { failDeletes: boolean };
};

/**
 * Wraps the real client so a row can read the key `putObject` was called with,
 * make `deleteObject` fail on demand, and observe the database at the moment
 * the object delete runs (`onDelete` — the ordering witness `remove`'s
 * "row first, then the object" claim needs; without it, moving the whole
 * delete block above `withTenant` leaves every other claim of that row true).
 */
function recordingClient(
  base: StorageClient,
  hooks: { onDelete?: (key: string) => Promise<void> } = {},
): StorageRecorder {
  if (base.kind !== "configured") {
    throw new Error("the integration client must be configured — the storage gate returned no config");
  }
  const calls: string[] = [];
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  const state = { failDeletes: false };
  const ops: S3Ops = {
    headBucket: (bucket) => base.ops.headBucket(bucket),
    createBucket: (bucket) => base.ops.createBucket(bucket),
    putObject: async (bucket, key, body, contentType) => {
      calls.push("putObject");
      putKeys.push(key);
      await base.ops.putObject(bucket, key, body, contentType);
    },
    getObject: (bucket, key) => base.ops.getObject(bucket, key),
    headObject: (bucket, key) => base.ops.headObject(bucket, key),
    deleteObject: async (bucket, key) => {
      calls.push("deleteObject");
      deleteKeys.push(key);
      if (hooks.onDelete) {
        await hooks.onDelete(key);
      }
      if (state.failDeletes) {
        throw new DeleteProbeError("probe: the object delete was refused");
      }
      await base.ops.deleteObject(bucket, key);
    },
  };
  return { client: { kind: "configured", bucket: base.bucket, ops }, calls, putKeys, deleteKeys, state };
}

function writeService(
  fx: AssetImageWriteFixtures,
  client: StorageClient,
  audit: MasterDataAuditService = new MasterDataAuditService(fx.tenantDb, fx.fleetDb),
): AssetImagesWriteService {
  return new AssetImagesWriteService(fx.tenantDb, fx.fleetDb, client, audit);
}

function uploadOnce(
  service: AssetImagesWriteService,
  fx: AssetImageWriteFixtures,
  assetId: string,
): Promise<AssetImageDto> {
  return service.upload(fx.actor, assetId, {
    buffer: PNG_BYTES,
    declaredType: "image/png",
    originalFilename: PNG_FILENAME,
    caption: PNG_CAPTION,
  });
}

/** Removes one image row and one object, and never lets one failure skip the other. */
async function discard(fx: AssetImageWriteFixtures, imageId: string, key: string | null): Promise<void> {
  const [dbDelete] = await Promise.allSettled([
    fx.fleetDb.delete(assetImages).where(eq(assetImages.id, imageId)),
    key === null ? Promise.resolve() : deleteObject(fx.client, key),
  ]);
  if (dbDelete.status === "rejected") {
    throw dbDelete.reason;
  }
}

// ---------------------------------------------------------------------------
// Row 1 — upload -> row -> content
// ---------------------------------------------------------------------------

type UploadRun = {
  readonly dto: AssetImageDto;
  readonly fetched: Buffer;
  readonly storedKey: string | null;
  readonly listed: readonly AssetImageDto[];
  readonly putKeys: readonly string[];
};

/**
 * One real upload on the committed fixture asset, then the **read** service
 * over the same bucket and the same database. Row and object go in `finally`.
 */
async function runUpload(fx: AssetImageWriteFixtures): Promise<UploadRun> {
  const recorder = recordingClient(fx.client);
  const dto = await uploadOnce(writeService(fx, recorder.client), fx, fx.assetId);
  const key = recorder.putKeys[0] ?? null;
  try {
    const reader = new AssetImagesService(fx.tenantDb, fx.fleetDb, fx.client);
    const content = await reader.content(fx.assetId, dto.id);
    const fetched = await collect(content.body);
    const listed = await reader.list(fx.assetId);
    const storedKey = await readObjectKey(fx.fleetDb, dto.id);
    return { dto, fetched, storedKey, listed, putKeys: recorder.putKeys };
  } finally {
    await discard(fx, dto.id, key);
  }
}

/** Decision 4: the DTO the write route answers carries no `objectKey`. */
export async function assertUploadReturnsADtoWithoutTheObjectKey(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runUpload(fx);
  const dto = run.dto as unknown as Record<string, unknown>;
  // The positive control: an empty object has no `objectKey` either.
  assert(typeof dto.id === "string" && dto.id.length > 0, `the upload returned no id; keys: ${Object.keys(dto).join(", ")}`);
  assert(
    !Object.hasOwn(dto, "objectKey"),
    `the uploaded DTO must not carry objectKey; keys: ${Object.keys(dto).join(", ")}`,
  );
}

/** Decision 10, through the write path: the bytes come back out of `…/content`. */
export async function assertContentStreamsTheUploadedBytes(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runUpload(fx);
  assert(
    run.fetched.length === PNG_BYTES.length,
    `the streamed body must be ${PNG_BYTES.length} bytes; got ${run.fetched.length}`,
  );
  assert(
    sha256Of(run.fetched) === run.dto.sha256,
    `the streamed object's sha256 must equal the DTO's; DTO ${run.dto.sha256}, streamed ${sha256Of(run.fetched)}`,
  );
}

/** R-6/decision 4: the stored key is `buildObjectKey` of the three ids, and nothing else. */
export async function assertTheStoredKeyIsTheBuiltKey(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runUpload(fx);
  const expected = buildObjectKey({
    organizationId: fx.orgAId,
    assetId: fx.assetId,
    imageId: run.dto.id,
  });
  assert(run.storedKey !== null, "the positive control failed: the fleet read found no row at all");
  assert(
    run.storedKey === expected,
    `the stored object_key must be the built key; stored ${String(run.storedKey)}, built ${expected}`,
  );
}

/** The uploaded row is listed by the read route — still without the key. */
export async function assertTheUploadIsListedWithoutTheObjectKey(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runUpload(fx);
  const listed = run.listed.find((image) => image.id === run.dto.id) as Record<string, unknown> | undefined;
  assert(
    listed !== undefined,
    `the list must contain the uploaded id ${run.dto.id}; got ${run.listed.map((i) => i.id).join(", ")}`,
  );
  assert(
    listed !== undefined && !Object.hasOwn(listed, "objectKey"),
    `the listed DTO must not carry objectKey; keys: ${Object.keys(listed ?? {}).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Row 2 — the audit row, inside the asset's own organization
// ---------------------------------------------------------------------------

type AuditRun = { readonly imageId: string; readonly rows: readonly AuditRow[] };

/** One upload, then the `master.asset_image.create` rows it wrote, read as fleet. */
async function runCreateAudit(fx: AssetImageWriteFixtures): Promise<AuditRun> {
  const recorder = recordingClient(fx.client);
  const dto = await uploadOnce(writeService(fx, recorder.client), fx, fx.assetId);
  try {
    return { imageId: dto.id, rows: await readAuditRows(fx.fleetDb, dto.id, "master.asset_image.create") };
  } finally {
    await discard(fx, dto.id, recorder.putKeys[0] ?? null);
  }
}

/** E7.1c item D: the audit row is stamped with the asset's own organization. */
export async function assertTheCreateAuditRowCarriesTheAssetsOrganization(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runCreateAudit(fx);
  assert(run.rows.length === 1, `expected exactly one create audit row for ${run.imageId}, got ${run.rows.length}`);
  assert(
    run.rows[0]?.organization_id === fx.orgAId,
    `the audit row's organization_id must be the asset's; got ${String(run.rows[0]?.organization_id)}`,
  );
}

/** The actor resolves to a real `bms.users` row — the seeded admin, not NULL. */
export async function assertTheCreateAuditRowNamesAnActor(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runCreateAudit(fx);
  assert(run.rows.length === 1, `expected exactly one create audit row for ${run.imageId}, got ${run.rows.length}`);
  assert(
    run.rows[0]?.actor_id === fx.actorId,
    `the audit row's actor_id must be the seeded actor ${fx.actorId}; got ${String(run.rows[0]?.actor_id)}`,
  );
}

/** §9.6: the payload carries ids, a code and numbers — never the filename or the caption. */
export async function assertTheCreateAuditPayloadOmitsTheFilenameAndCaption(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runCreateAudit(fx);
  const payload = run.rows[0]?.payload ?? null;
  assert(payload !== null, "the positive control failed: the audit row has no payload at all");
  const keys = Object.keys(payload ?? {});
  // The positive control for the two absences below: the payload is populated.
  assert(keys.includes("sha256"), `the payload must carry sha256; keys: ${keys.join(", ")}`);
  assert(
    !keys.includes("originalFilename") && !keys.includes("caption"),
    `the payload must carry neither originalFilename nor caption; keys: ${keys.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Row 3 — the RLS negative, on a real `bms_tenant` connection
// ---------------------------------------------------------------------------

/** The ten-key `values` shape `AssetImagesWriteService` inserts, ids apart. */
function writeServiceValues(input: {
  imageId: string;
  organizationId: string;
  assetId: string;
  createdBy: string | null;
}): typeof assetImages.$inferInsert {
  return {
    id: input.imageId,
    organizationId: input.organizationId,
    assetId: input.assetId,
    objectKey: buildObjectKey({
      organizationId: input.organizationId,
      assetId: input.assetId,
      imageId: input.imageId,
    }),
    contentType: "image/png",
    byteSize: PNG_BYTES.length,
    sha256: sha256Of(PNG_BYTES),
    originalFilename: PNG_FILENAME,
    caption: PNG_CAPTION,
    createdBy: input.createdBy,
  };
}

type RlsRun = { readonly crossOrg: unknown; readonly sameOrg: number };

/**
 * R-6's negative. Under organization A's GUC, insert the service's own `values`
 * shape for A's asset but stamped `organization_id = B`: only `0072`'s own-column
 * `WITH CHECK` can refuse it. The correctly-stamped insert follows in the same
 * transaction, so a refusal that came from somewhere else (a grant, a CHECK) is
 * visible rather than read as the policy working.
 *
 * The refused insert runs inside a nested transaction — a SAVEPOINT — because a
 * failed statement aborts the whole transaction and the positive control would
 * then fail with `25P02`, saying nothing about the policy.
 */
async function runRlsStamp(fx: AssetImageWriteFixtures): Promise<RlsRun> {
  let crossOrg: unknown;
  let sameOrg = -1;
  await withRollback(fx.tenantDb, async (tx) => {
    await setTenant(tx, fx.orgAId);
    const [ownAssetId] = await createFixtureAssets(tx, 1, "f3-4", fx.locationA);

    crossOrg = await captureRejection(() =>
      tx.transaction((inner) =>
        inner.insert(assetImages).values(
          writeServiceValues({
            imageId: randomUUID(),
            organizationId: fx.orgBId,
            assetId: ownAssetId as string,
            createdBy: fx.actorId,
          }),
        ),
      ),
    );

    const sameId = randomUUID();
    await tx.insert(assetImages).values(
      writeServiceValues({
        imageId: sameId,
        organizationId: fx.orgAId,
        assetId: ownAssetId as string,
        createdBy: fx.actorId,
      }),
    );
    sameOrg = await countImageRow(tx, sameId);

    await tx.rollback();
  });
  return { crossOrg, sameOrg };
}

/** `42501` — `insufficient_privilege`, the code Postgres answers a `WITH CHECK` violation with. */
export async function assertAnInsertStampedWithAnotherOrganizationIsRefused(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runRlsStamp(fx);
  const state = sqlState(run.crossOrg);
  assert(
    state === "42501",
    `an image row stamped with organization B under organization A's GUC must be refused with ` +
      `SQLSTATE 42501; got ${String(state)} (${errorName(run.crossOrg)})`,
  );
}

/** The adjacent positive control: the correctly-stamped insert lands. */
export async function assertTheCorrectlyStampedInsertIsAccepted(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runRlsStamp(fx);
  assert(
    run.sameOrg === 1,
    `the same insert stamped with the asset's own organization must land; saw ${run.sameOrg} rows — ` +
      "the refusal above would otherwise be consistent with the policy refusing everything",
  );
}

// ---------------------------------------------------------------------------
// Row 4 — the cap, against rows that are really committed
// ---------------------------------------------------------------------------

type CapRun = {
  readonly uploaded: readonly string[];
  readonly err: unknown;
  /** The call list of the refused upload alone — a delta, never a lifetime count. */
  readonly refusedDelta: readonly string[];
  readonly countAfter: number;
  readonly putCount: number;
};

/**
 * Fills the cap asset to `MAX_ASSET_IMAGES_PER_ASSET` through the real service,
 * then asks for one more. Every row and every object is removed in `finally` —
 * a leftover would make the *next* run's first upload the refused one.
 */
async function runCap(fx: AssetImageWriteFixtures): Promise<CapRun> {
  const recorder = recordingClient(fx.client);
  const service = writeService(fx, recorder.client);
  const uploaded: string[] = [];
  try {
    for (let i = 0; i < MAX_ASSET_IMAGES_PER_ASSET; i += 1) {
      const dto = await uploadOnce(service, fx, fx.capAssetId);
      uploaded.push(dto.id);
    }
    const before = recorder.calls.length;
    const err = await captureRejection(() => uploadOnce(service, fx, fx.capAssetId));
    const refusedDelta = recorder.calls.slice(before);
    return {
      uploaded,
      err,
      refusedDelta,
      countAfter: await countImagesForAsset(fx.fleetDb, fx.capAssetId),
      putCount: recorder.putKeys.length,
    };
  } finally {
    const [dbDelete] = await Promise.allSettled([
      fx.fleetDb.delete(assetImages).where(eq(assetImages.assetId, fx.capAssetId)),
      Promise.allSettled(recorder.putKeys.map((key) => deleteObject(fx.client, key))),
    ]);
    if (dbDelete.status === "rejected") {
      throw dbDelete.reason;
    }
  }
}

/** R-3: the upload past the cap is a 409, not a 400 and not a silent 21st row. */
export async function assertTheUploadPastTheCapIsAConflict(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runCap(fx);
  // The positive control: the cap was actually reached before the refusal.
  assert(
    run.uploaded.length === MAX_ASSET_IMAGES_PER_ASSET,
    `the positive control failed: ${run.uploaded.length} of ${MAX_ASSET_IMAGES_PER_ASSET} uploads landed`,
  );
  assert(
    errorName(run.err) === "ConflictException",
    `the upload past the cap must be a ConflictException; got ${errorName(run.err)}`,
  );
}

/** …and the refusal leaves exactly the cap behind, read as fleet for that asset alone. */
export async function assertTheCapLeavesExactlyTwentyRows(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runCap(fx);
  assert(
    run.countAfter === MAX_ASSET_IMAGES_PER_ASSET,
    `the asset must still hold ${MAX_ASSET_IMAGES_PER_ASSET} rows; the fleet count is ${run.countAfter}`,
  );
}

/** R-3: the cheap pre-check refuses **before** the put, so the common refusal costs no upload. */
export async function assertTheRefusedUploadPutNoObject(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runCap(fx);
  // The positive control for the absence: the recorder did see the 20 puts.
  assert(
    run.putCount === MAX_ASSET_IMAGES_PER_ASSET,
    `the positive control failed: the recorder saw ${run.putCount} puts, expected ${MAX_ASSET_IMAGES_PER_ASSET}`,
  );
  assert(
    !run.refusedDelta.includes("putObject"),
    `the refused upload must call no S3 operation at all; its calls were: ${run.refusedDelta.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Row 5 — the orphan cleanup is real
// ---------------------------------------------------------------------------

type FailedRowRun = {
  readonly err: unknown;
  readonly before: number;
  readonly after: number;
  readonly putKeys: readonly string[];
  readonly deleteKeys: readonly string[];
  readonly head: { contentLength: number } | null;
};

/**
 * R-2's cleanup, measured against the bucket. The audit write inside the tenant
 * transaction throws once, so the transaction rolls back after `putObject`
 * already succeeded — the exact window decision 4 tolerates an orphan in — and
 * the service's best-effort `deleteObject` has to really remove the object.
 */
async function runFailedRowWrite(fx: AssetImageWriteFixtures): Promise<FailedRowRun> {
  const recorder = recordingClient(fx.client);
  const audit = new MasterDataAuditService(fx.tenantDb, fx.fleetDb);
  const spy = vi
    .spyOn(audit, "write")
    .mockRejectedValueOnce(new AuditProbeError("probe: the audit write was refused"));
  const before = await countImagesForAsset(fx.fleetDb, fx.assetId);
  let head: { contentLength: number } | null = null;
  let key: string | null = null;
  try {
    const err = await captureRejection(() => uploadOnce(writeService(fx, recorder.client, audit), fx, fx.assetId));
    key = recorder.putKeys[0] ?? null;
    head = key === null ? null : await headObject(fx.client, key);
    return {
      err,
      before,
      after: await countImagesForAsset(fx.fleetDb, fx.assetId),
      putKeys: recorder.putKeys,
      deleteKeys: recorder.deleteKeys,
      head,
    };
  } finally {
    spy.mockRestore();
    if (head !== null && key !== null) {
      await deleteObject(fx.client, key).catch(() => undefined);
    }
  }
}

/** The failure reaches the caller by its own name — the service rethrows, it does not swallow. */
export async function assertAFailedRowWriteRejectsWithTheOriginalError(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runFailedRowWrite(fx);
  assert(
    errorName(run.err) === "AuditProbeError",
    `the original error must reach the caller by name; got ${errorName(run.err)}`,
  );
}

/** The transaction rolled back: no row for that asset was added. */
export async function assertAFailedRowWriteLeavesNoRow(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runFailedRowWrite(fx);
  assert(
    run.after === run.before,
    `a failed row write must leave the asset's row count unchanged; before ${run.before}, after ${run.after}`,
  );
}

/** …and the object it had already put is really gone from the bucket. */
export async function assertAFailedRowWriteRemovesTheObject(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runFailedRowWrite(fx);
  // The positive controls for the absence: the object was really put, and the
  // cleanup really ran on that key. Without them a null head passes when the
  // upload failed before reaching the bucket at all.
  assert(run.putKeys.length === 1, `the positive control failed: ${run.putKeys.length} puts, expected 1`);
  assert(
    run.deleteKeys.length === 1 && run.deleteKeys[0] === run.putKeys[0],
    `the cleanup must delete the key it put; put ${String(run.putKeys[0])}, deleted ${run.deleteKeys.join(", ")}`,
  );
  assert(
    run.head === null,
    `headObject on the cleaned-up key must answer null; the object is still in the bucket ` +
      `(${String(run.head?.contentLength)} bytes)`,
  );
}

// ---------------------------------------------------------------------------
// Rows 6 and 7 — remove, and decision 11 on a real endpoint
// ---------------------------------------------------------------------------

type RemoveRun = {
  readonly imageId: string;
  readonly rowBefore: number;
  readonly rowAfter: number;
  readonly headBefore: { contentLength: number } | null;
  readonly object: Awaited<ReturnType<typeof getObject>>;
  readonly auditRows: readonly AuditRow[];
  /** The row count observed **inside** `deleteObject` — the ordering witness. */
  readonly rowsWhenTheObjectWasDeleted: number;
};

/**
 * One upload, then the real `remove`. The witness inside `deleteObject` is what
 * makes the ordering claim testable: with the delete moved above `withTenant`
 * every other claim of this row still holds — the object is gone, the row is
 * gone, the call resolved — and only the witness sees the row still present.
 */
async function runRemove(fx: AssetImageWriteFixtures): Promise<RemoveRun> {
  let watched = "";
  let rowsWhenTheObjectWasDeleted = -1;
  const recorder = recordingClient(fx.client, {
    onDelete: async () => {
      rowsWhenTheObjectWasDeleted = watched === "" ? -1 : await countImageRow(fx.fleetDb, watched);
    },
  });
  const service = writeService(fx, recorder.client);
  const dto = await uploadOnce(service, fx, fx.assetId);
  watched = dto.id;
  const key = recorder.putKeys[0] ?? null;
  let object: Awaited<ReturnType<typeof getObject>> = null;
  try {
    const rowBefore = await countImageRow(fx.fleetDb, dto.id);
    const headBefore = key === null ? null : await headObject(fx.client, key);

    await service.remove(fx.actor, fx.assetId, dto.id);

    object = key === null ? null : await getObject(fx.client, key);
    return {
      imageId: dto.id,
      rowBefore,
      rowAfter: await countImageRow(fx.fleetDb, dto.id),
      headBefore,
      object,
      auditRows: await readAuditRows(fx.fleetDb, dto.id, "master.asset_image.delete"),
      rowsWhenTheObjectWasDeleted,
    };
  } finally {
    object?.body.destroy();
    await discard(fx, dto.id, key);
  }
}

/** `remove` takes the row out — read as fleet, with the control that it was there. */
export async function assertRemoveDeletesTheRow(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runRemove(fx);
  assert(run.rowBefore === 1, `the positive control failed: the uploaded row's count was ${run.rowBefore}`);
  assert(run.rowAfter === 0, `remove must delete the row; the fleet count is ${run.rowAfter}`);
}

/** …and audits the deletion inside the same transaction. */
export async function assertRemoveWritesTheDeleteAuditRow(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runRemove(fx);
  assert(
    run.auditRows.length === 1,
    `expected one master.asset_image.delete row for ${run.imageId}, got ${run.auditRows.length}`,
  );
  assert(
    run.auditRows[0]?.entity_id === run.imageId,
    `the delete audit row's entity_id must be the image id; got ${String(run.auditRows[0]?.entity_id)}`,
  );
}

/** …and the object is really gone: `getObject` on the captured key answers null. */
export async function assertRemoveDeletesTheObject(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runRemove(fx);
  // The positive control for the absence: the object existed before `remove`.
  assert(run.headBefore !== null, "the positive control failed: the uploaded object was not in the bucket");
  assert(run.object === null, "remove must delete the object; getObject still answers a body");
}

/**
 * Decision 11's ordering: the object is deleted **after** the row's transaction
 * committed, so a bucket that is down leaves a row-less orphan and never a
 * rowed object-less image (the 404 that lies).
 */
export async function assertRemoveDeletesTheObjectOnlyAfterTheRowIsGone(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runRemove(fx);
  assert(
    run.rowsWhenTheObjectWasDeleted === 0,
    `when deleteObject ran, the row must already be committed away; the fleet count was ` +
      `${run.rowsWhenTheObjectWasDeleted} (-1 means deleteObject never ran)`,
  );
}

type OrphanRun = {
  readonly imageId: string;
  readonly rowBefore: number;
  readonly rowAfter: number;
  readonly warns: readonly string[];
  readonly head: { contentLength: number } | null;
  readonly key: string;
};

/**
 * Decision 11 on the real endpoint: the object delete fails after the row is
 * gone. `remove` resolves, warns once, and the orphan really stays in the
 * bucket — which is why this row deletes it by hand in `finally`.
 */
async function runOrphanedRemove(fx: AssetImageWriteFixtures): Promise<OrphanRun> {
  const recorder = recordingClient(fx.client);
  const service = writeService(fx, recorder.client);
  const dto = await uploadOnce(service, fx, fx.assetId);
  const key = recorder.putKeys[0] as string;
  try {
    const rowBefore = await countImageRow(fx.fleetDb, dto.id);
    // Only now, so the upload's own put still reached the bucket.
    recorder.state.failDeletes = true;
    const { warns } = await capturingWarns(() => service.remove(fx.actor, fx.assetId, dto.id));
    recorder.state.failDeletes = false;
    return {
      imageId: dto.id,
      rowBefore,
      rowAfter: await countImageRow(fx.fleetDb, dto.id),
      warns,
      head: await headObject(fx.client, key),
      key,
    };
  } finally {
    recorder.state.failDeletes = false;
    await discard(fx, dto.id, key);
  }
}

/** The method resolves: a bucket that refuses the delete is not the caller's problem. */
export async function assertRemoveResolvesWhenTheObjectDeleteFails(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  // `runOrphanedRemove` awaits `remove` without catching, so reaching its
  // result at all is the claim; a rejection propagates here and reddens this row.
  const run = await runOrphanedRemove(fx);
  assert(run.rowBefore === 1, `the positive control failed: the uploaded row's count was ${run.rowBefore}`);
}

/** …and the row is still deleted: the transaction had already committed. */
export async function assertTheRowIsGoneWhenTheObjectDeleteFails(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  assert(run.rowBefore === 1, `the positive control failed: the uploaded row's count was ${run.rowBefore}`);
  assert(run.rowAfter === 0, `the row must be gone even when the object delete failed; count ${run.rowAfter}`);
}

/** One warn, naming the image id — the id is what an operator can act on. */
export async function assertTheOrphanWarnNamesTheImageIdOnce(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  assert(run.warns.length === 1, `expected one warn, saw ${run.warns.length}: ${run.warns.join(" | ")}`);
  assert(
    run.warns[0]?.includes(run.imageId) === true,
    `the warn must name the image id; got: ${String(run.warns[0])}`,
  );
}

/** …and never the key (§9.6): the prefix, the organization id and the asset id are all absent. */
export async function assertTheOrphanWarnNeverNamesTheKey(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  const joined = run.warns.join("\n");
  // The positive control lives in the row above: one warn, and it names the id.
  assert(
    !joined.includes(OBJECT_KEY_PREFIX) && !joined.includes(fx.orgAId) && !joined.includes(fx.assetId),
    `the warn must carry no part of the object key; got: ${joined}`,
  );
}

/** Decision 11: the orphan object really is left behind — that is the tolerated cost. */
export async function assertTheOrphanObjectStaysInTheBucket(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  assert(
    run.head !== null,
    "the object must still exist after a failed delete — decision 11 tolerates the orphan, and a " +
      "null head here would mean the delete that 'failed' actually removed it",
  );
}

// ---------------------------------------------------------------------------
// Row 8 — remove refuses an image that belongs to another asset (review Sec M-1)
// ---------------------------------------------------------------------------

/**
 * An image of one asset, asked for through **another** asset's delete route.
 *
 * `remove`'s `and(eq(id, imageId), eq(assetId, assetId))` is the only control
 * that scopes a delete **inside** one organization: both assets here live in
 * organization A and in `locationA`, so the tenant GUC, `0072`'s policy and
 * `canManageAsset` are all satisfied for both and none of them can refuse
 * this call. Drop the `assetId` conjunct and the row is deleted and audited
 * under an asset it never belonged to, and its object with it — a caller who
 * can manage any one asset can delete any image in the organization by id.
 *
 * Two asserts, because the first throws: the refusal and the survival of the
 * row and the object are separate claims.
 */
async function runForeignRemove(
  fx: AssetImageWriteFixtures,
): Promise<{ err: unknown; rowAfter: number; head: { contentLength: number } | null }> {
  const recorder = recordingClient(fx.client);
  const service = writeService(fx, recorder.client);
  const dto = await uploadOnce(service, fx, fx.foreignAssetId);
  const key = recorder.putKeys[0] as string;
  try {
    const err = await captureRejection(() => service.remove(fx.actor, fx.assetId, dto.id));
    return { err, rowAfter: await countImageRow(fx.fleetDb, dto.id), head: await headObject(fx.client, key) };
  } finally {
    await discard(fx, dto.id, key);
  }
}

/** Another asset's image is not found on this asset's route. */
export async function assertRemovingAnotherAssetsImageIsNotFound(fx: AssetImageWriteFixtures): Promise<void> {
  const run = await runForeignRemove(fx);
  assert(
    errorName(run.err) === "NotFoundException",
    `removing an image of ${fx.foreignAssetId} through ${fx.assetId} threw ${errorName(run.err)}`,
  );
}

/** …and the refusal really refused: the row and the object both survive it. */
export async function assertARefusedForeignRemoveLeavesTheRowAndTheObject(
  fx: AssetImageWriteFixtures,
): Promise<void> {
  const run = await runForeignRemove(fx);
  assert(run.rowAfter === 1, `the other asset's image row must survive the refusal; the fleet count is ${run.rowAfter}`);
  assert(run.head !== null, "the other asset's object must survive the refusal; headObject answered null");
}
