import { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";
import { MAX_ASSET_IMAGE_BYTES, MAX_ASSET_IMAGES_PER_ASSET } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { MasterDataAuditService, AuditInput } from "../admin/master-data-audit.service";
import { buildObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import type { S3Ops, StorageClient } from "../storage/storage-client";
import { dbBlindTo } from "../testing/blinded-db";
import { AssetImagesWriteService } from "./asset-images-write.service";

/**
 * `F3.4` (ADR 0066 Amendment 3, R-1..R-6) — `AssetImagesWriteService` over
 * fakes. Assertions live here; `asset-images-write.service.test.ts` is the
 * Vitest entry point (§4.6/ADR 0014).
 *
 * The fakes follow `asset-images.service.spec.ts`: chainable pool fakes
 * dispatched on the `select` projection's shape (the `blinded-db` key), an
 * in-memory `S3Ops` that records every call into **one** ordered `calls`
 * list shared with the tenant fake's `tx:commit` entry — so "the object is
 * deleted after the row's transaction committed" is a deep-equal on that
 * list, never a lifetime count. `Logger.prototype.warn` is spied and
 * restored in `finally`; errors are matched on `err.name`.
 *
 * `remove`'s fixture row carries a key whose last segment is `OTHER_ID`, not
 * the image id, for the reason the F3.3 spec gives: "the warn names the
 * image id" and "the warn never carries the key" stay two independent
 * claims. On `upload` the key is built from the generated id, so there the
 * leak claim (`OBJECT_KEY_PREFIX` absent) is the load-bearing one.
 */

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const ASSET_ID = "22222222-2222-4222-8222-222222222222";
export const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = new Date("2026-09-16T10:00:00.000Z");
export const JWT: JwtPayload = { sub: ACTOR_ID, email: "admin@bms.local", name: "Admin", role: "admin" };
const CAP: number = MAX_ASSET_IMAGES_PER_ASSET;

/** A key built through the one authority; its last segment is deliberately not `IMAGE_ID`. */
export const FIXTURE_KEY = buildObjectKey({ organizationId: ORG_ID, assetId: ASSET_ID, imageId: OTHER_ID });

/** Real PNG signature bytes plus padding past the 12-byte sniff floor. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IHDRpad!"),
]);

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

export function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { name?: unknown }).name?.toString() : undefined;
}

export function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
}

export function namedError(name: string): Error {
  // The message carries a key, so a warn that quoted `err.message` reddens the leak rows.
  const err = new Error(`fake ${name}: ${FIXTURE_KEY}`);
  err.name = name;
  return err;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A query builder that accepts any chain, reports each method to `onCall`, and resolves `resolve()` when awaited. */
function chain(resolve: () => Promise<unknown>, onCall?: (method: string, args: unknown[]) => void): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => resolve().then(res, rej);
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function shapeOf(projection?: Record<string, unknown>): string {
  return projection === undefined ? "" : Object.keys(projection).sort().join(",");
}

export type Scenario = {
  client?: StorageClient;
  /** Row 1 only: make the fleet organization read throw, so a read that reaches it is counted. */
  blindOrgRead?: boolean;
  orgRows?: { organizationId: string | null }[];
  fleetCount?: number;
  /**
   * The rows the fleet count query answers with, verbatim — the one way to
   * reach a **non-numeric** count. `fleetCount` can only ever supply a
   * number, so with it alone `countImages`' `Number(row?.count)` never
   * returns `NaN` and the fail-closed compare the service's docblock claims
   * (`!(n < cap)`) is asserted by nothing: `current >= cap` passes every row
   * in this file.
   */
  fleetCountRows?: { count: unknown }[];
  txAssetRows?: { id: string }[];
  txCount?: number;
  insertError?: Error;
  deleteRows?: { objectKey: string }[];
  putObject?: () => Promise<void>;
  deleteObject?: () => Promise<void>;
};

export type Harness = {
  service: AssetImagesWriteService;
  calls: string[];
  putKeys: string[];
  deleteKeys: string[];
  insertedIds: string[];
  tenantTransactions: () => number;
  blindedReads: () => number;
  audit: { inputs: AuditInput[]; executors: unknown[] };
  tx: object;
};

export function harness(scenario: Scenario = {}): Harness {
  const calls: string[] = [];
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  const insertedIds: string[] = [];
  let tenantTransactions = 0;

  const fleetPlain = {
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      return chain(async () => {
        if (shape === "organizationId") return scenario.orgRows ?? [{ organizationId: ORG_ID }];
        if (shape === "count") return scenario.fleetCountRows ?? [{ count: scenario.fleetCount ?? 0 }];
        if (shape === "id") return [{ id: ACTOR_ID }];
        throw new Error(`fleet fake: unexpected select shape ${shape}`);
      });
    },
    transaction: () => {
      throw new Error("fleetDb.transaction must never run: the write is a tenant transaction (R-6)");
    },
  } as unknown as BmsDb;
  const fleet = scenario.blindOrgRead ? dbBlindTo(fleetPlain, "organizationId") : { db: fleetPlain, blindedReads: () => 0 };

  const tx = {
    execute: async () => undefined,
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      return chain(async () => {
        if (shape === "id") return scenario.txAssetRows ?? [{ id: ASSET_ID }];
        if (shape === "count") return [{ count: scenario.txCount ?? 0 }];
        throw new Error(`tenant fake: unexpected select shape ${shape}`);
      });
    },
    insert: () => {
      let values: Record<string, unknown> = {};
      return chain(
        async () => {
          if (scenario.insertError) throw scenario.insertError;
          return [{ ...values, createdAt: CREATED_AT }];
        },
        (method, args) => {
          if (method === "values") {
            values = args[0] as Record<string, unknown>;
            insertedIds.push(String(values.id));
          }
        },
      );
    },
    delete: () => chain(async () => scenario.deleteRows ?? []),
  };
  const tenant = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      tenantTransactions += 1;
      const result = await fn(tx);
      calls.push("tx:commit");
      return result;
    },
  } as unknown as BmsDb;

  const unreachable = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} must not be called by the write path`);
  };
  const ops: S3Ops = {
    headBucket: unreachable("headBucket") as S3Ops["headBucket"],
    createBucket: unreachable("createBucket"),
    putObject: async (_bucket, key) => {
      calls.push("putObject");
      putKeys.push(key);
      await (scenario.putObject ?? (async () => undefined))();
    },
    getObject: unreachable("getObject") as S3Ops["getObject"],
    headObject: unreachable("headObject") as S3Ops["headObject"],
    deleteObject: async (_bucket, key) => {
      calls.push("deleteObject");
      deleteKeys.push(key);
      await (scenario.deleteObject ?? (async () => undefined))();
    },
  };
  const client: StorageClient = scenario.client ?? { kind: "configured", bucket: "bms-asset-images", ops };

  const audit = { inputs: [] as AuditInput[], executors: [] as unknown[] };
  const auditFake = {
    write: async (input: AuditInput, executor: unknown) => {
      audit.inputs.push(input);
      audit.executors.push(executor);
    },
  } as unknown as MasterDataAuditService;

  const service = new AssetImagesWriteService(tenant, fleet.db, client, auditFake);
  return {
    service,
    calls,
    putKeys,
    deleteKeys,
    insertedIds,
    tenantTransactions: () => tenantTransactions,
    blindedReads: fleet.blindedReads,
    audit,
    tx,
  };
}

const UNCONFIGURED: StorageClient = { kind: "unconfigured" };

export async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const warns: string[] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  try {
    const result = await fn();
    return { result, warns };
  } finally {
    spy.mockRestore();
  }
}

function pngUpload(h: Harness, declaredType = "image/png", buffer: Buffer = PNG_BYTES) {
  return h.service.upload(JWT, ASSET_ID, { buffer, declaredType, originalFilename: "pump.png", caption: null });
}

type RejectedRun = { err: unknown; warns: string[]; h: Harness };

async function runUploadRejecting(scenario: Scenario, declaredType = "image/png", buffer: Buffer = PNG_BYTES): Promise<RejectedRun> {
  const h = harness(scenario);
  const { result: err, warns } = await capturingWarns(() => captureRejection(() => pngUpload(h, declaredType, buffer)));
  return { err, warns, h };
}

// ---------------------------------------------------------------------------
// Row 1: unconfigured refuses before any pool is touched
// ---------------------------------------------------------------------------

const unconfiguredBlinded = (): Scenario => ({ client: UNCONFIGURED, blindOrgRead: true });

export async function assertUnconfiguredUploadRejectsServiceUnavailable(): Promise<void> {
  const { err } = await runUploadRejecting(unconfiguredBlinded());
  assert(errorName(err) === "ServiceUnavailableException", `unconfigured upload threw ${errorName(err)}: ${errorMessage(err)}`);
}

export async function assertUnconfiguredUploadTouchesNoPool(): Promise<void> {
  const { h } = await runUploadRejecting(unconfiguredBlinded());
  assert(
    h.blindedReads() === 0 && h.tenantTransactions() === 0,
    `unconfigured upload touched a pool: fleet reads ${h.blindedReads()}, tenant transactions ${h.tenantTransactions()}`,
  );
}

/** Positive control for the blinding: configured, the same fake's organization read is reached once. */
export async function assertBlindedFleetReadIsReachedWhenConfigured(): Promise<void> {
  const { err, h } = await runUploadRejecting({ blindOrgRead: true });
  assert(h.blindedReads() === 1, `expected one blinded fleet read, saw ${h.blindedReads()}`);
  assert(errorMessage(err).startsWith("blinded-db:"), `expected the blinded read's error, got ${errorMessage(err)}`);
}

export async function assertUnconfiguredRemoveRejectsServiceUnavailable(): Promise<void> {
  const h = harness(unconfiguredBlinded());
  const err = await captureRejection(() => h.service.remove(JWT, ASSET_ID, IMAGE_ID));
  assert(errorName(err) === "ServiceUnavailableException" && h.blindedReads() === 0, `unconfigured remove threw ${errorName(err)} after ${h.blindedReads()} fleet reads`);
}

// ---------------------------------------------------------------------------
// Rows 2-4: declared type, sniff agreement, size (R-1, R-4)
// ---------------------------------------------------------------------------

export async function assertDeclaredTextPlainRejectsBadRequest(): Promise<void> {
  const { err } = await runUploadRejecting({}, "text/plain");
  assert(errorName(err) === "BadRequestException", `declared text/plain threw ${errorName(err)}`);
}

export async function assertDeclaredTextPlainMakesNoStorageCall(): Promise<void> {
  const { h } = await runUploadRejecting({}, "text/plain");
  assert(h.calls.length === 0, `declared text/plain reached storage: ${h.calls.join(", ")}`);
}

export async function assertDeclaredTypeRefusalNeverEchoesTheDeclaredString(): Promise<void> {
  const { err } = await runUploadRejecting({}, "text/plain");
  assert(
    errorMessage(err) === "Only JPEG, PNG or WebP images are accepted",
    `the declared-type 400 must be the fixed sentence, got: ${errorMessage(err)}`,
  );
}

export async function assertPngBytesDeclaredJpegRejectsMismatch(): Promise<void> {
  const { err } = await runUploadRejecting({}, "image/jpeg");
  assert(
    errorName(err) === "BadRequestException" && errorMessage(err).includes("does not match"),
    `PNG bytes declared image/jpeg threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertPngBytesDeclaredJpegMakesNoStorageCall(): Promise<void> {
  const { h } = await runUploadRejecting({}, "image/jpeg");
  assert(h.calls.length === 0, `a sniff mismatch reached storage: ${h.calls.join(", ")}`);
}

/** Positive control: the same bytes declared image/png reach putObject exactly once. */
export async function assertPngBytesDeclaredPngReachPutObjectOnce(): Promise<void> {
  const h = harness();
  await pngUpload(h);
  assert(h.calls.filter((c) => c === "putObject").length === 1, `expected one putObject, saw ${h.calls.join(", ")}`);
}

export async function assertUnrecognisedBytesRejectBadRequest(): Promise<void> {
  const { err, h } = await runUploadRejecting({}, "image/png", Buffer.from("GIF89a-not-an-image-we-serve"));
  assert(
    errorName(err) === "BadRequestException" && errorMessage(err).includes("not a JPEG") && h.calls.length === 0,
    `unrecognised bytes threw ${errorName(err)}: ${errorMessage(err)} after ${h.calls.join(", ")}`,
  );
}

export async function assertEmptyBufferRejectsBadRequest(): Promise<void> {
  const { err, h } = await runUploadRejecting({}, "image/png", Buffer.alloc(0));
  assert(
    errorName(err) === "BadRequestException" && errorMessage(err) === "Image file is required" && h.calls.length === 0,
    `an empty buffer threw ${errorName(err)}: ${errorMessage(err)} after ${h.calls.join(", ")}`,
  );
}

export async function assertOversizeBufferRejectsPayloadTooLarge(): Promise<void> {
  const { err, h } = await runUploadRejecting({}, "image/png", Buffer.alloc(MAX_ASSET_IMAGE_BYTES + 1));
  assert(
    errorName(err) === "PayloadTooLargeException" && h.calls.length === 0,
    `${MAX_ASSET_IMAGE_BYTES + 1} bytes threw ${errorName(err)} after ${h.calls.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Rows 5-6: the cap, checked on the fleet pool and again under FOR UPDATE (R-3)
// ---------------------------------------------------------------------------

export async function assertFleetPreCountAtCapRejectsConflict(): Promise<void> {
  const { err } = await runUploadRejecting({ fleetCount: CAP });
  assert(
    errorName(err) === "ConflictException" && errorMessage(err).includes(`${CAP} images`),
    `a fleet pre-count of ${CAP} threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertFleetPreCountAtCapMakesNoStorageCall(): Promise<void> {
  const { h } = await runUploadRejecting({ fleetCount: CAP });
  assert(h.calls.length === 0, `the pre-count refusal reached storage: ${h.calls.join(", ")}`);
}

/**
 * A count that is not a number refuses the upload rather than admitting it.
 *
 * The service's docblock claims the compare is fail-closed — `!(n < cap)`, so
 * an unreadable count refuses — and until this row every scenario handed the
 * fake a real number, which `current >= cap` satisfies just as well. An empty
 * result set makes `Number(row?.count)` `NaN`; every comparison against `NaN`
 * is false, so `>=` would let the upload through with the cap unchecked. Two
 * asserts, because the first throws: the refusal and the untouched bucket are
 * separate claims.
 */
const unreadableFleetCount = (): Scenario => ({ fleetCountRows: [] });

export async function assertAnUnreadableCountRejectsConflict(): Promise<void> {
  const { err } = await runUploadRejecting(unreadableFleetCount());
  assert(
    errorName(err) === "ConflictException",
    `a NaN count must refuse the upload (!(n < cap)); it threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertAnUnreadableCountMakesNoStorageCall(): Promise<void> {
  const { h } = await runUploadRejecting(unreadableFleetCount());
  assert(h.calls.length === 0, `a NaN count reached storage: ${h.calls.join(", ")}`);
}

export async function assertTenantCountAtCapRejectsConflict(): Promise<void> {
  const { err } = await runUploadRejecting({ fleetCount: CAP - 1, txCount: CAP });
  assert(errorName(err) === "ConflictException", `the tenant-transaction count at ${CAP} threw ${errorName(err)}`);
}

export async function assertTenantCountAtCapPutsThenDeletesTheObject(): Promise<void> {
  const { h } = await runUploadRejecting({ fleetCount: CAP - 1, txCount: CAP });
  assert(
    JSON.stringify(h.calls) === JSON.stringify(["putObject", "deleteObject"]),
    `expected exactly [putObject, deleteObject], saw [${h.calls.join(", ")}]`,
  );
}

export async function assertVanishedAssetUnderForUpdateRejectsNotFound(): Promise<void> {
  const { err, h } = await runUploadRejecting({ txAssetRows: [] });
  assert(
    errorName(err) === "NotFoundException" && JSON.stringify(h.calls) === JSON.stringify(["putObject", "deleteObject"]),
    `a vanished asset threw ${errorName(err)} with calls [${h.calls.join(", ")}]`,
  );
}

// ---------------------------------------------------------------------------
// Rows 7-8: insert failure cleans up; a failed cleanup warns once, never the key (R-2)
// ---------------------------------------------------------------------------

const insertDown = (): Scenario => ({ insertError: namedError("FakeInsertError") });

export async function assertInsertFailureRethrowsByName(): Promise<void> {
  const { err } = await runUploadRejecting(insertDown());
  assert(errorName(err) === "FakeInsertError", `an insert failure surfaced as ${errorName(err)}`);
}

export async function assertInsertFailurePutsThenDeletesTheObject(): Promise<void> {
  const { h } = await runUploadRejecting(insertDown());
  assert(
    JSON.stringify(h.calls) === JSON.stringify(["putObject", "deleteObject"]),
    `expected exactly [putObject, deleteObject], saw [${h.calls.join(", ")}]`,
  );
}

export async function assertInsertFailureDeletesTheKeyItPut(): Promise<void> {
  const { h } = await runUploadRejecting(insertDown());
  assert(h.deleteKeys[0] === h.putKeys[0] && h.putKeys.length === 1, "cleanup must delete the exact key putObject wrote");
}

const cleanupDown = (): Scenario => ({
  insertError: namedError("FakeInsertError"),
  deleteObject: async () => {
    throw namedError("TimeoutError");
  },
});

export async function assertCleanupFailureStillThrowsTheOriginalError(): Promise<void> {
  const { err } = await runUploadRejecting(cleanupDown());
  assert(errorName(err) === "FakeInsertError", `a failed cleanup surfaced as ${errorName(err)}`);
}

export async function assertCleanupFailureWarnsOnceNamingTheImageIdAndErrorName(): Promise<void> {
  const { warns, h } = await runUploadRejecting(cleanupDown());
  const imageId = h.insertedIds[0] ?? "";
  assert(warns.length === 1, `expected one warn, saw ${warns.length}: ${warns.join(" | ")}`);
  assert(imageId.length > 0 && warns[0]?.includes(imageId) === true, `the warn must name the image id ${imageId}: ${warns[0]}`);
  assert(warns[0]?.includes("TimeoutError") === true, `the warn must name err.name: ${warns[0]}`);
}

/** The leak row: the key ends in the image id, so only the prefix check can tell a logged key from a logged id. */
export async function assertCleanupFailureWarnNeverCarriesTheKey(): Promise<void> {
  const { warns } = await runUploadRejecting(cleanupDown());
  assert(!warns.join("\n").includes(OBJECT_KEY_PREFIX), `the cleanup warn must not carry the object key: ${warns.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Row 9: put rejects → 503, warn, and no tenant transaction (R-2, Q-F)
// ---------------------------------------------------------------------------

const putDown = (): Scenario => ({
  putObject: async () => {
    throw namedError("TimeoutError");
  },
});

export async function assertPutFailureRejectsServiceUnavailable(): Promise<void> {
  const { err } = await runUploadRejecting(putDown());
  assert(
    errorName(err) === "ServiceUnavailableException" && errorMessage(err) === "Object storage is unreachable",
    `a put failure threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertPutFailureOpensNoTenantTransaction(): Promise<void> {
  const { h } = await runUploadRejecting(putDown());
  assert(h.tenantTransactions() === 0, `a put failure must open no tenant transaction, saw ${h.tenantTransactions()}`);
}

/** The image id is the key's last segment (`buildObjectKey`); the fake never sees it any other way before the insert. */
export async function assertPutFailureWarnNamesTheImageIdAndErrorName(): Promise<void> {
  const { warns, h } = await runUploadRejecting(putDown());
  const imageId = h.putKeys[0]?.split("/").pop() ?? "";
  assert(warns.length === 1, `expected one warn, saw ${warns.length}: ${warns.join(" | ")}`);
  assert(
    imageId.length === 36 && warns[0]?.includes(imageId) === true && warns[0]?.includes("TimeoutError") === true,
    `the warn must name the image id ${imageId} and err.name: ${warns[0]}`,
  );
}

export async function assertPutFailureWarnAndResponseNeverCarryTheKey(): Promise<void> {
  const { warns, err } = await runUploadRejecting(putDown());
  assert(
    !warns.join("\n").includes(OBJECT_KEY_PREFIX) && !errorMessage(err).includes(OBJECT_KEY_PREFIX),
    `neither the warn nor the 503 may carry the object key: ${warns.join(" | ")} / ${errorMessage(err)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 10: the happy path
// ---------------------------------------------------------------------------

async function runHappyUpload(): Promise<{ dto: Record<string, unknown>; h: Harness; warns: string[] }> {
  const h = harness();
  const { result, warns } = await capturingWarns(() =>
    h.service.upload(JWT, ASSET_ID, { buffer: PNG_BYTES, declaredType: "image/png", originalFilename: "pump.png", caption: "Pump 1" }),
  );
  return { dto: result as unknown as Record<string, unknown>, h, warns };
}

/** Positive control for the absence row below: the DTO is the inserted row. */
export async function assertUploadDtoCarriesTheInsertedId(): Promise<void> {
  const { dto, h } = await runHappyUpload();
  assert(dto.id === h.insertedIds[0] && h.insertedIds.length === 1, `expected the inserted id ${h.insertedIds[0]}, got ${String(dto.id)}`);
}

export async function assertUploadDtoHasNoObjectKey(): Promise<void> {
  const { dto } = await runHappyUpload();
  assert(!("objectKey" in dto) && !JSON.stringify(dto).includes(OBJECT_KEY_PREFIX), "the upload DTO must not carry objectKey (decision 4)");
}

export async function assertUploadDtoSha256IsTheBufferHash(): Promise<void> {
  const { dto } = await runHappyUpload();
  const expected = createHash("sha256").update(PNG_BYTES).digest("hex");
  assert(dto.sha256 === expected, `sha256 was ${String(dto.sha256)}, expected ${expected}`);
}

export async function assertUploadDtoContentTypeIsTheSniffedType(): Promise<void> {
  const { dto } = await runHappyUpload();
  assert(dto.contentType === "image/png", `contentType was ${String(dto.contentType)}`);
}

export async function assertUploadDtoByteSizeIsTheBufferLength(): Promise<void> {
  const { dto } = await runHappyUpload();
  assert(dto.byteSize === PNG_BYTES.length, `byteSize was ${String(dto.byteSize)}, expected ${PNG_BYTES.length}`);
}

export async function assertUploadStoresTheResolvedActorAsCreatedBy(): Promise<void> {
  const { dto } = await runHappyUpload();
  assert(dto.createdBy === ACTOR_ID, `createdBy was ${String(dto.createdBy)}, expected ${ACTOR_ID}`);
}

export async function assertUploadPutsTheObjectBeforeTheTransactionCommits(): Promise<void> {
  const { h, warns } = await runHappyUpload();
  assert(
    JSON.stringify(h.calls) === JSON.stringify(["putObject", "tx:commit"]) && h.tenantTransactions() === 1 && warns.length === 0,
    `expected [putObject, tx:commit] in one transaction with no warn, saw [${h.calls.join(", ")}] / ${warns.join(" | ")}`,
  );
}

export async function assertUploadAuditCarriesTheAssetOrganizationAndTheTx(): Promise<void> {
  const { h } = await runHappyUpload();
  const input = h.audit.inputs[0];
  assert(h.audit.inputs.length === 1, `expected one audit write, saw ${h.audit.inputs.length}`);
  assert(
    input?.organizationId === ORG_ID && h.audit.executors[0] === h.tx,
    `audit organizationId ${String(input?.organizationId)} / executor is tx: ${String(h.audit.executors[0] === h.tx)}`,
  );
}

export async function assertUploadAuditNamesTheActionEntityAndImage(): Promise<void> {
  const { h } = await runHappyUpload();
  const input = h.audit.inputs[0];
  assert(
    input?.action === "master.asset_image.create" && input.entityType === "asset_image" && input.entityId === h.insertedIds[0],
    `audit row was ${JSON.stringify(input)}`,
  );
}

/** §9.6: ids, a code and numbers only — the filename and the caption are the client's text. */
export async function assertUploadAuditPayloadCarriesNoFilenameOrCaption(): Promise<void> {
  const { h } = await runHappyUpload();
  const payload = JSON.stringify(h.audit.inputs[0]?.payload ?? {});
  assert(payload.includes(ASSET_ID) && payload.includes("image/png"), `positive control: payload must carry the asset id and the type: ${payload}`);
  assert(!payload.includes("pump.png") && !payload.includes("Pump 1"), `the audit payload must not carry the filename or caption: ${payload}`);
}
