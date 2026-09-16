import { Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";

import { buildObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import type { S3Ops, StorageClient } from "../storage/storage-client";
import { dbBlindTo } from "../testing/blinded-db";
import { AssetImagesService } from "./asset-images.service";

/**
 * `F3.3` (ADR 0066 decisions 3, 4; Amendment 1 Q-F) — `AssetImagesService`
 * over fakes. Assertions live here; `asset-images.service.test.ts` is the
 * Vitest entry point (§4.6/ADR 0014).
 *
 * **The storage half only.** The fleet and tenant pools are chainable fakes
 * that answer a fixed row list, so the claims here are about what the
 * service does *around* the read: that an unconfigured client refuses before
 * any pool is touched (the fleet fake is `dbBlindTo`'d on the exact
 * projection `withReadScope` resolves the organization with, and
 * `blindedReads()` is the count of reads that reached it), that the DTO
 * never carries `objectKey`, and what the two storage failures log and
 * throw. The database halves — the `0072` policy, the cascade, a real 404
 * against a real row — are the integration spec's (Unit 7).
 *
 * The fixture row's key is **a real key whose last segment is not the image
 * id** — built by `buildObjectKey` from `OTHER_ID` — so "the warn names the
 * image id" and "the warn never carries
 * the key" are two independent claims: a real key ends in the image id, and
 * a fixture that copied that shape would let a warn that logged the key
 * pass the id check.
 *
 * Warn lines are captured by spying `Logger.prototype.warn`
 * (`parse-stored-contract.spec.ts` precedent), restored in `finally`.
 * Errors are matched on `err.name`, never `instanceof`.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
/**
 * Built through the one authority rather than from the `org/` literal
 * (ADR 0066 decision 4; the literal lives in `object-key.ts` and its own
 * spec alone, held by `tests/f3.3-object-storage-invariants.test.ts`). The
 * last segment is `OTHER_ID`, not `IMAGE_ID`, for the reason the docblock
 * above gives — the leak claim and the id claim stay independent.
 */
export const FIXTURE_KEY = buildObjectKey({
  organizationId: ORG_ID,
  assetId: ASSET_ID,
  imageId: OTHER_ID,
});
const BYTES = Buffer.from("png-bytes");

type FixtureRow = {
  id: string;
  assetId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string;
  caption: string | null;
  createdBy: string | null;
  createdAt: Date;
};

function fixtureRow(): FixtureRow {
  return {
    id: IMAGE_ID,
    assetId: ASSET_ID,
    objectKey: FIXTURE_KEY,
    contentType: "image/png",
    byteSize: BYTES.length,
    sha256: "a".repeat(64),
    originalFilename: "pump.png",
    caption: null,
    createdBy: null,
    createdAt: new Date("2026-09-15T10:00:00.000Z"),
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Captures a rejection. A call that resolves fails here, never inside a `catch`. */
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

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message)
    : "";
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A query builder that accepts any chain and resolves to `rows` when awaited. */
function chainResolving(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

/** The fleet pool: `withReadScope` resolves the organization here; `transaction` must never run on it for a single-org read. */
function fleetDbFake(orgRows: { organizationId: string }[]): BmsDb {
  return {
    select: () => chainResolving(orgRows),
    transaction: () => {
      throw new Error("fleetDb.transaction must not run for a single-organization read");
    },
  } as unknown as BmsDb;
}

/** The tenant pool: `withTenant` opens a transaction, sets the GUC and reads the rows. */
function tenantDbFake(imageRows: FixtureRow[]): { db: BmsDb; transactions: () => number } {
  let transactions = 0;
  const tx = {
    execute: async () => undefined,
    select: () => chainResolving(imageRows),
  };
  const db = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      transactions += 1;
      return fn(tx);
    },
  } as unknown as BmsDb;
  return { db, transactions: () => transactions };
}

type OpsFake = { ops: S3Ops; calls: string[] };

/** An `S3Ops` whose `getObject` answers what the scenario says; every other op is unreachable here. */
function opsFake(getObject: S3Ops["getObject"]): OpsFake {
  const calls: string[] = [];
  const unreachable = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} must not be called by a read route`);
  };
  const ops: S3Ops = {
    headBucket: unreachable("headBucket") as S3Ops["headBucket"],
    createBucket: unreachable("createBucket"),
    putObject: unreachable("putObject"),
    getObject: async (bucket, key) => {
      calls.push(`getObject ${bucket} ${key}`);
      return getObject(bucket, key);
    },
    headObject: unreachable("headObject") as S3Ops["headObject"],
    deleteObject: unreachable("deleteObject"),
  };
  return { ops, calls };
}

const UNCONFIGURED: StorageClient = { kind: "unconfigured" };

function configured(ops: S3Ops): StorageClient {
  return { kind: "configured", bucket: "bms-asset-images", ops };
}

/** Runs `fn` with `Logger.prototype.warn` captured; restores the spy whatever happens. */
async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
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

// ---------------------------------------------------------------------------
// Decision 3: unconfigured refuses before any pool is touched
// ---------------------------------------------------------------------------

type UnconfiguredRun = { err: unknown; blindedReads: number; tenantTransactions: number };

async function runUnconfigured(method: "list" | "content"): Promise<UnconfiguredRun> {
  // `withReadScope` resolves the organization with `select({ organizationId })`
  // on the fleet pool; that exact projection is blinded, so any read that
  // reaches it rejects with a plain Error and is counted.
  const fleet = dbBlindTo(fleetDbFake([{ organizationId: ORG_ID }]), "organizationId");
  const tenant = tenantDbFake([fixtureRow()]);
  const service = new AssetImagesService(tenant.db, fleet.db, UNCONFIGURED);
  const err = await captureRejection(() =>
    method === "list" ? service.list(ASSET_ID) : service.content(ASSET_ID, IMAGE_ID),
  );
  return { err, blindedReads: fleet.blindedReads(), tenantTransactions: tenant.transactions() };
}

export const SERVICE_METHODS = ["list", "content"] as const;

export async function assertUnconfiguredRejectsServiceUnavailable(
  method: (typeof SERVICE_METHODS)[number],
): Promise<void> {
  const { err } = await runUnconfigured(method);
  assert(
    errorName(err) === "ServiceUnavailableException",
    `${method} on an unconfigured client threw ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertUnconfiguredMessageNamesTheVariable(
  method: (typeof SERVICE_METHODS)[number],
): Promise<void> {
  const { err } = await runUnconfigured(method);
  const message = errorMessage(err);
  assert(
    message ===
      "Object storage is not configured: OBJECT_STORAGE_ENDPOINT is unset (ADR 0066 decision 3)",
    `${method}: unexpected 503 message: ${message}`,
  );
}

export async function assertUnconfiguredTouchesNoPool(
  method: (typeof SERVICE_METHODS)[number],
): Promise<void> {
  const { blindedReads, tenantTransactions } = await runUnconfigured(method);
  assert(
    blindedReads === 0 && tenantTransactions === 0,
    `${method} touched a pool before the storage check: fleet reads ${blindedReads}, tenant transactions ${tenantTransactions}`,
  );
}

/** The positive control for the blinding: the same fake, configured, does read the fleet pool once. */
export async function assertBlindedFleetReadIsReachedWhenConfigured(): Promise<void> {
  const fleet = dbBlindTo(fleetDbFake([{ organizationId: ORG_ID }]), "organizationId");
  const tenant = tenantDbFake([fixtureRow()]);
  const { ops } = opsFake(async () => null);
  const service = new AssetImagesService(tenant.db, fleet.db, configured(ops));
  const err = await captureRejection(() => service.list(ASSET_ID));
  assert(fleet.blindedReads() === 1, `expected one blinded fleet read, saw ${fleet.blindedReads()}`);
  assert(errorMessage(err).startsWith("blinded-db:"), `expected the blinded read's error, got ${errorMessage(err)}`);
}

// ---------------------------------------------------------------------------
// list: the DTO, never the key, inside the tenant transaction
// ---------------------------------------------------------------------------

async function runList(): Promise<{ dtos: Record<string, unknown>[]; tenantTransactions: number }> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([fixtureRow()]);
  const { ops } = opsFake(async () => null);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const dtos = (await service.list(ASSET_ID)) as unknown as Record<string, unknown>[];
  return { dtos, tenantTransactions: tenant.transactions() };
}

export async function assertListReturnsOneDtoPerRow(): Promise<void> {
  const { dtos } = await runList();
  assert(dtos.length === 1, `expected one DTO, got ${dtos.length}`);
}

/** The positive control for the absence check below: the DTO carries the row's id. */
export async function assertListDtoCarriesTheId(): Promise<void> {
  const { dtos } = await runList();
  assert(dtos[0]?.id === IMAGE_ID, `expected id ${IMAGE_ID}, got ${String(dtos[0]?.id)}`);
}

export async function assertListDtoHasNoObjectKey(): Promise<void> {
  const { dtos } = await runList();
  const dto = dtos[0] ?? {};
  assert(!("objectKey" in dto), "the list DTO must not carry objectKey (ADR 0066 decision 4)");
}

export async function assertListDtoNeverCarriesTheKeyValue(): Promise<void> {
  const { dtos } = await runList();
  assert(!JSON.stringify(dtos).includes(OBJECT_KEY_PREFIX), "no DTO field may carry the object key value");
}

export async function assertListSerialisesCreatedAtAsIso(): Promise<void> {
  const { dtos } = await runList();
  assert(dtos[0]?.createdAt === "2026-09-15T10:00:00.000Z", `createdAt was ${String(dtos[0]?.createdAt)}`);
}

export async function assertListRunsInsideTheTenantTransaction(): Promise<void> {
  const { tenantTransactions } = await runList();
  assert(tenantTransactions === 1, `expected one tenant transaction, saw ${tenantTransactions}`);
}

export async function assertListAnswersEmptyWhenTheAssetResolvesToNoOrganization(): Promise<void> {
  const fleet = fleetDbFake([]);
  const tenant = tenantDbFake([fixtureRow()]);
  const { ops } = opsFake(async () => null);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const dtos = await service.list(ASSET_ID);
  assert(dtos.length === 0 && tenant.transactions() === 0, "an unresolved asset must answer [] with no tenant read");
}

// ---------------------------------------------------------------------------
// content: the row is the authority (decision 4), transport failure (Q-F)
// ---------------------------------------------------------------------------

type ContentRun = { err: unknown; warns: string[]; calls: string[] };

async function runContentRejecting(
  rows: FixtureRow[],
  getObject: S3Ops["getObject"],
): Promise<ContentRun> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake(rows);
  const { ops, calls } = opsFake(getObject);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const { result: err, warns } = await capturingWarns(() =>
    captureRejection(() => service.content(ASSET_ID, IMAGE_ID)),
  );
  return { err, warns, calls };
}

function namedError(name: string): Error {
  const err = new Error(`fake ${name}: ${FIXTURE_KEY}`);
  err.name = name;
  return err;
}

const noObject: S3Ops["getObject"] = async () => null;
const transportDown: S3Ops["getObject"] = async () => {
  throw namedError("TimeoutError");
};

export async function assertContentWithNoRowRejectsNotFound(): Promise<void> {
  const { err } = await runContentRejecting([], noObject);
  assert(errorName(err) === "NotFoundException", `no row threw ${errorName(err)}`);
}

export async function assertContentWithNoRowNeverReachesStorage(): Promise<void> {
  const { calls } = await runContentRejecting([], noObject);
  assert(calls.length === 0, `no row must make no storage call, saw ${calls.join(", ")}`);
}

export async function assertContentWithNoObjectRejectsNotFound(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], noObject);
  assert(errorName(err) === "NotFoundException", `a row with no object threw ${errorName(err)}`);
}

export async function assertContentWithNoObjectWarnsOnce(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], noObject);
  assert(warns.length === 1, `expected one warn, saw ${warns.length}: ${warns.join(" | ")}`);
}

export async function assertContentWithNoObjectWarnNamesTheImageId(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], noObject);
  assert(warns[0]?.includes(IMAGE_ID) === true, `the warn must name the image id: ${warns[0]}`);
}

export async function assertContentWithNoObjectWarnNeverCarriesTheKey(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], noObject);
  assert(!warns.join("\n").includes(OBJECT_KEY_PREFIX), `the warn must not carry the object key: ${warns.join(" | ")}`);
}

export async function assertContentWithNoObjectAskedStorageForTheRowsKey(): Promise<void> {
  const { calls } = await runContentRejecting([fixtureRow()], noObject);
  assert(
    calls.length === 1 && calls[0] === `getObject bms-asset-images ${FIXTURE_KEY}`,
    `expected one getObject on the row's key, saw ${calls.join(", ")}`,
  );
}

export async function assertTransportErrorRejectsServiceUnavailable(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], transportDown);
  assert(errorName(err) === "ServiceUnavailableException", `a transport error threw ${errorName(err)}`);
}

export async function assertTransportErrorMessageIsUnreachable(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], transportDown);
  assert(errorMessage(err) === "Object storage is unreachable", `unexpected message: ${errorMessage(err)}`);
}

export async function assertTransportErrorWarnNamesTheImageIdAndTheErrorName(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], transportDown);
  assert(warns.length === 1, `expected one warn, saw ${warns.length}`);
  assert(
    warns[0]?.includes(IMAGE_ID) === true && warns[0]?.includes("TimeoutError") === true,
    `the warn must name the image id and err.name: ${warns[0]}`,
  );
}

/** The fake error's own message carries the key, so a warn that quoted `err.message` reddens here. */
export async function assertTransportErrorWarnNeverCarriesTheKey(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], transportDown);
  assert(!warns.join("\n").includes(OBJECT_KEY_PREFIX), `the warn must not carry the object key: ${warns.join(" | ")}`);
}

export async function assertTransportErrorResponseNeverCarriesTheKey(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], transportDown);
  assert(!errorMessage(err).includes(OBJECT_KEY_PREFIX), `the 503 must not carry the object key: ${errorMessage(err)}`);
}

// ---------------------------------------------------------------------------
// Review findings (2026-09-15): Content-Length authority, and the enum parse
// ---------------------------------------------------------------------------

/** The bucket answers a body whose `contentLength` is what the scenario says; `BYTES` is 9 bytes. */
function objectOfLength(contentLength: number | null): S3Ops["getObject"] {
  return async () => ({ body: Readable.from([BYTES]), contentLength });
}

/**
 * The row is the authority (decision 4) — and `Content-Length` is sent from
 * the row. An object whose reported length differs from `byte_size` would
 * make the API send a header the body cannot honour: the client sees a
 * truncated or over-long stream under a 200. That is the decision-4
 * missing-object case, not a happy path: 404, and one warn naming the image
 * id and both numbers.
 */
export async function assertContentLengthMismatchRejectsNotFound(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], objectOfLength(BYTES.length + 1));
  assert(errorName(err) === "NotFoundException", `a length mismatch threw ${errorName(err)}`);
}

export async function assertContentLengthMismatchWarnNamesTheImageIdAndBothNumbers(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], objectOfLength(BYTES.length + 1));
  assert(warns.length === 1, `expected one warn, saw ${warns.length}: ${warns.join(" | ")}`);
  const warn = warns[0] ?? "";
  assert(
    warn.includes(IMAGE_ID) && warn.includes(String(BYTES.length)) && warn.includes(String(BYTES.length + 1)),
    `the warn must name the image id, the row's byteSize and the object's length: ${warn}`,
  );
}

export async function assertContentLengthMismatchWarnNeverCarriesTheKey(): Promise<void> {
  const { warns } = await runContentRejecting([fixtureRow()], objectOfLength(BYTES.length + 1));
  assert(!warns.join("\n").includes(OBJECT_KEY_PREFIX), `the warn must not carry the object key: ${warns.join(" | ")}`);
}

/** The two served cases: an equal length, and a bucket that reports none. */
export const SERVED_CONTENT_LENGTHS = [
  { label: "equal to byteSize", contentLength: BYTES.length },
  { label: "null (unreported)", contentLength: null },
] as const;

export async function assertContentIsServedWhenTheLengthIs(
  scenario: (typeof SERVED_CONTENT_LENGTHS)[number],
): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([fixtureRow()]);
  const { ops } = opsFake(objectOfLength(scenario.contentLength));
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const { result, warns } = await capturingWarns(() => service.content(ASSET_ID, IMAGE_ID));
  assert(result.row.id === IMAGE_ID, `a length ${scenario.label} must be served; got row ${result.row.id}`);
  assert(warns.length === 0, `a length ${scenario.label} must not warn: ${warns.join(" | ")}`);
}

/**
 * `toDto` parses `content_type` through `assetImageContentTypeSchema` rather
 * than casting: the CHECK backs the enum in SQL, but the derivation (ADR
 * 0030) is load-bearing in the code as well — a row outside the vocabulary
 * must throw, never be served as a typed value it is not. It throws the
 * `parseStoredContract` 500 (ADR 0060): the row is the server's, so a
 * `ZodError` reaching the global filter would answer 400 for a fault the
 * caller cannot correct (`tests/f4.108-service-parses-are-guarded.test.ts`).
 */
export async function assertARowOutsideTheContentTypeEnumThrows(): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([{ ...fixtureRow(), contentType: "image/gif" }]);
  const { ops } = opsFake(async () => null);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const err = await captureRejection(() => service.list(ASSET_ID));
  assert(
    errorName(err) === "InternalServerErrorException",
    `a row with content_type image/gif threw ${errorName(err)}, not the stored-contract 500`,
  );
  assert(
    errorName(err) !== "ZodError",
    "a bare ZodError would reach the global filter and answer 400 for the server's own row",
  );
  assert(
    String((err as Error).message).includes("asset_images.to_dto.row"),
    `the 500 must name the stored-contract context, got: ${String((err as Error).message)}`,
  );
}

// ---------------------------------------------------------------------------
// Post-merge sweep (2026-09-15): the WHOLE DTO is parsed, not one column
// ---------------------------------------------------------------------------

/**
 * `0072` constrains `content_type` and nothing else: `sha256`,
 * `original_filename` and `caption` are `text`. Until the sweep `toDto`
 * parsed only the enum, so a stored `sha256` carrying a CR reached the
 * controller's `res.setHeader("ETag", …)`, which throws
 * `ERR_INVALID_CHAR` **before** `pipeline` — and the MinIO stream
 * `content()` had already opened was never consumed or destroyed. Each row
 * here breaks one field `assetImageDtoSchema` bounds and `0072` does not,
 * and expects the stored-contract 500 (ADR 0060 ruling 2) from `list`.
 */
export const CONTRACT_BREAKING_ROWS = [
  { label: "sha256 with a carriage return", patch: { sha256: `${"a".repeat(63)}\r` } },
  { label: "originalFilename of 256 chars", patch: { originalFilename: "f".repeat(256) } },
  { label: "caption of 1001 chars", patch: { caption: "c".repeat(1001) } },
  // Post-merge sweep (security Low): the contract now refuses a C0/C1
  // control character in either free-text field, so a row stored before the
  // regex landed — or written around the API — is a server fault, exactly
  // like the three above.
  { label: "originalFilename with a carriage return", patch: { originalFilename: "pump\r.png" } },
] as const;

export async function assertAContractBreakingRowThrowsTheStoredContract500(
  scenario: (typeof CONTRACT_BREAKING_ROWS)[number],
): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([{ ...fixtureRow(), ...scenario.patch }]);
  const { ops } = opsFake(async () => null);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const err = await captureRejection(() => service.list(ASSET_ID));
  assert(
    errorName(err) === "InternalServerErrorException",
    `a row with ${scenario.label} threw ${errorName(err)}, not the stored-contract 500`,
  );
  assert(
    String((err as Error).message).includes("asset_images.to_dto.row"),
    `the 500 must name the whole-row context, got: ${String((err as Error).message)}`,
  );
}

/** An `S3Ops` whose body is recorded, so a test can ask whether it was left open. */
function recordingObject(): { getObject: S3Ops["getObject"]; body: () => Readable | undefined } {
  let body: Readable | undefined;
  return {
    getObject: async () => {
      body = Readable.from([BYTES]);
      return { body, contentLength: BYTES.length };
    },
    body: () => body,
  };
}

/**
 * The stream half of the defect: on `content`, a row that breaks its
 * contract must not leave the object stream open. Either the bucket was
 * never asked (the parse ran first) or the body it answered is destroyed —
 * a body that exists and is not destroyed is the leaked socket.
 */
export async function assertAContractBreakingRowOnContentLeavesNoBodyOpen(): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([{ ...fixtureRow(), sha256: `${"a".repeat(63)}\r` }]);
  const recorded = recordingObject();
  const { ops } = opsFake(recorded.getObject);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const err = await captureRejection(() => service.content(ASSET_ID, IMAGE_ID));
  assert(errorName(err) === "InternalServerErrorException", `content threw ${errorName(err)}`);
  const body = recorded.body();
  assert(
    body === undefined || body.destroyed,
    "the object stream was opened for a row that cannot be served, and it was left open",
  );
}

/**
 * The stream half for the sweep's own field: a stored `original_filename`
 * carrying a CR must not leave the object stream open either.
 *
 * It is a separate row rather than a parameter of the one above because that
 * one's fixture is the `sha256` Amendment 2 measured; a shared fixture would
 * hide which field the parse caught.
 */
export async function assertAControlCharacterFilenameOnContentLeavesNoBodyOpen(): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([{ ...fixtureRow(), originalFilename: "pump\r.png" }]);
  const recorded = recordingObject();
  const { ops } = opsFake(recorded.getObject);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const err = await captureRejection(() => service.content(ASSET_ID, IMAGE_ID));
  assert(errorName(err) === "InternalServerErrorException", `content threw ${errorName(err)}`);
  const body = recorded.body();
  assert(
    body === undefined || body.destroyed,
    "a filename with a control character opened the object stream and left it open",
  );
}

/** The positive control for the recording fake: a valid row is served and its body is live. */
export async function assertAValidRowOnContentIsServedWithALiveBody(): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([fixtureRow()]);
  const recorded = recordingObject();
  const { ops } = opsFake(recorded.getObject);
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const { row, body } = await service.content(ASSET_ID, IMAGE_ID);
  assert(row.sha256 === "a".repeat(64), `a valid row must be served; got sha256 ${row.sha256}`);
  assert(recorded.body() === body && !body.destroyed, "the served body must be the bucket's, and live");
}

export async function assertContentReturnsTheDtoAndTheBody(): Promise<void> {
  const fleet = fleetDbFake([{ organizationId: ORG_ID }]);
  const tenant = tenantDbFake([fixtureRow()]);
  const { ops } = opsFake(async () => ({ body: Readable.from([BYTES]), contentLength: BYTES.length }));
  const service = new AssetImagesService(tenant.db, fleet, configured(ops));
  const { result, warns } = await capturingWarns(() => service.content(ASSET_ID, IMAGE_ID));
  const chunks: Buffer[] = [];
  for await (const chunk of result.body) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  assert(Buffer.concat(chunks).equals(BYTES), "the body must be the object's bytes");
  assert(!("objectKey" in result.row) && result.row.id === IMAGE_ID, "content's row is the DTO, without objectKey");
  assert(warns.length === 0, `the happy path must not warn: ${warns.join(" | ")}`);
}
