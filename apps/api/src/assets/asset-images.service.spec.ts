import { Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";

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
 * The fixture row's key is a **fixed literal whose last segment is not the
 * image id**, so "the warn names the image id" and "the warn never carries
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
export const FIXTURE_KEY = `org/${ORG_ID}/assets/${ASSET_ID}/${OTHER_ID}`;
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
  assert(!JSON.stringify(dtos).includes("org/"), "no DTO field may carry the object key value");
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
  assert(!warns.join("\n").includes("org/"), `the warn must not carry the object key: ${warns.join(" | ")}`);
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
  assert(!warns.join("\n").includes("org/"), `the warn must not carry the object key: ${warns.join(" | ")}`);
}

export async function assertTransportErrorResponseNeverCarriesTheKey(): Promise<void> {
  const { err } = await runContentRejecting([fixtureRow()], transportDown);
  assert(!errorMessage(err).includes("org/"), `the 503 must not carry the object key: ${errorMessage(err)}`);
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
