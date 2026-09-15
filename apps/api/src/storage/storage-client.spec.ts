import type { Logger } from "@nestjs/common";
import { Readable } from "node:stream";

import { buildObjectKey } from "./object-key";
import type { StorageConfig } from "./storage-config";
import {
  createStorageClient,
  deleteObject,
  ensureBucket,
  getObject,
  headObject,
  putObject,
  type S3Ops,
  type StorageClient,
  StorageUnavailableError,
} from "./storage-client";

/**
 * F3.3 (ADR 0066 decisions 3, 9) — the storage client over an in-memory
 * `S3Ops` fake.
 *
 * Assertions live here; `storage-client.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). The fake records every call in `calls`; assertions read
 * a **delta** of that list around the call under test, never its lifetime
 * length, so an earlier call in the same fixture cannot make a later
 * assertion pass or fail. Errors are matched on `err.name`, never
 * `instanceof`. `captureRejection`'s sentinel lives outside the `try`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Captures a rejection. A call that resolves fails here, with this message, never inside a `catch`. */
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

function namedError(name: string): Error {
  const err = new Error(`fake ${name}`);
  err.name = name;
  return err;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const CONFIGURED: StorageConfig = {
  kind: "configured",
  endpoint: new URL("https://s3.example.test"),
  bucket: "the-bucket",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cr3tvalue",
  region: "us-east-1",
  forcePathStyle: true,
};

const UNCONFIGURED: StorageConfig = { kind: "unconfigured" };

type FakeState = {
  buckets: Set<string>;
  objects: Map<string, { body: Buffer; contentType: string }>;
  calls: string[];
  /** When set, `createBucket` throws this once and then behaves. */
  createBucketError: Error | null;
};

/** The in-memory `S3Ops`: a bucket set, a key→bytes map and a call recorder. */
function makeFakeOps(state: FakeState): S3Ops {
  const objectKey = (bucket: string, key: string): string => `${bucket}/${key}`;
  return {
    headBucket: async (bucket) => {
      state.calls.push(`headBucket:${bucket}`);
      return state.buckets.has(bucket) ? "ok" : "missing";
    },
    createBucket: async (bucket) => {
      state.calls.push(`createBucket:${bucket}`);
      if (state.createBucketError !== null) {
        const err = state.createBucketError;
        state.createBucketError = null;
        // A race: the other replica created it before this call landed.
        state.buckets.add(bucket);
        throw err;
      }
      state.buckets.add(bucket);
    },
    putObject: async (bucket, key, body, contentType) => {
      state.calls.push(`putObject:${bucket}:${key}`);
      state.objects.set(objectKey(bucket, key), { body: Buffer.from(body), contentType });
    },
    getObject: async (bucket, key) => {
      state.calls.push(`getObject:${bucket}:${key}`);
      const stored = state.objects.get(objectKey(bucket, key));
      if (!stored) {
        return null;
      }
      return { body: Readable.from([stored.body]), contentLength: stored.body.length };
    },
    headObject: async (bucket, key) => {
      state.calls.push(`headObject:${bucket}:${key}`);
      const stored = state.objects.get(objectKey(bucket, key));
      return stored ? { contentLength: stored.body.length } : null;
    },
    deleteObject: async (bucket, key) => {
      state.calls.push(`deleteObject:${bucket}:${key}`);
      state.objects.delete(objectKey(bucket, key));
    },
  };
}

type Fixture = {
  client: StorageClient;
  state: FakeState;
  warns: string[];
  createOpsCalls: number;
};

function makeFixture(config: StorageConfig, createBucketError: Error | null = null): Fixture {
  const state: FakeState = {
    buckets: new Set(),
    objects: new Map(),
    calls: [],
    createBucketError,
  };
  const warns: string[] = [];
  const fixture = { state, warns, createOpsCalls: 0 } as Omit<Fixture, "client">;
  const client = createStorageClient(config, {
    createOps: () => {
      fixture.createOpsCalls += 1;
      return makeFakeOps(state);
    },
    logger: {
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    } as Pick<Logger, "warn">,
  });
  return { client, ...fixture };
}

/** Runs `run` and returns the calls the fake recorded during it — the delta, not the lifetime list. */
async function callsDuring(state: FakeState, run: () => Promise<unknown>): Promise<string[]> {
  const before = state.calls.length;
  await run();
  return state.calls.slice(before);
}

/**
 * Built through the one key authority rather than written out (ADR 0066
 * decision 4): the `org/` literal lives in `object-key.ts` and in its own
 * spec alone, which `tests/f3.3-object-storage-invariants.test.ts` holds.
 * The client treats the key as an opaque string, so any valid key serves.
 */
const KEY = buildObjectKey({
  organizationId: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  imageId: "33333333-3333-4333-8333-333333333333",
});

export function assertUnconfiguredClientWarnsOnceAndBuildsNoOps(): void {
  const { client, warns, createOpsCalls } = makeFixture(UNCONFIGURED);
  assert(client.kind === "unconfigured", `expected kind "unconfigured", got "${client.kind}"`);
  assert(
    warns.length === 1 &&
      warns[0] ===
        "OBJECT_STORAGE_ENDPOINT missing; object storage unconfigured — asset image routes answer 503 (ADR 0066 decision 3)",
    `expected exactly one warn with the decision-3 sentence, got ${JSON.stringify(warns)}`,
  );
  assert(createOpsCalls === 0, `an unconfigured client must not build an S3Ops, createOps ran ${createOpsCalls} times`);
}

/** Positive control for the one-warn rule: a configured client warns nothing and builds the ops once. */
export function assertConfiguredClientDoesNotWarnAndBindsTheBucket(): void {
  const { client, warns, createOpsCalls } = makeFixture(CONFIGURED);
  assert(warns.length === 0, `a configured client must not warn, got ${JSON.stringify(warns)}`);
  assert(createOpsCalls === 1, `expected createOps to run once, ran ${createOpsCalls} times`);
  assert(
    client.kind === "configured" && client.bucket === "the-bucket",
    `expected a configured client bound to "the-bucket", got ${JSON.stringify(client)}`,
  );
}

export async function assertUnconfiguredPutObjectRejectsWithStorageUnavailableError(): Promise<void> {
  const { client } = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() => putObject(client, KEY, Buffer.from("x"), "image/png"));
  assert(
    errorName(err) === "StorageUnavailableError",
    `expected err.name === "StorageUnavailableError", got "${errorName(err)}"`,
  );
}

export const UNCONFIGURED_OPERATIONS = ["getObject", "headObject", "deleteObject"] as const;

export async function assertUnconfiguredOperationRejects(
  operation: (typeof UNCONFIGURED_OPERATIONS)[number],
): Promise<void> {
  const { client } = makeFixture(UNCONFIGURED);
  const run = {
    getObject: () => getObject(client, KEY),
    headObject: () => headObject(client, KEY),
    deleteObject: () => deleteObject(client, KEY),
  }[operation];
  const err = await captureRejection(run);
  assert(
    errorName(err) === "StorageUnavailableError",
    `expected ${operation} to reject with err.name === "StorageUnavailableError", got "${errorName(err)}"`,
  );
}

export async function assertEnsureBucketCreatesAMissingBucketOnce(): Promise<void> {
  const { client, state } = makeFixture(CONFIGURED);
  const delta = await callsDuring(state, () => ensureBucket(client));
  assert(
    JSON.stringify(delta) === JSON.stringify(["headBucket:the-bucket", "createBucket:the-bucket"]),
    `expected headBucket then createBucket on a missing bucket, got ${JSON.stringify(delta)}`,
  );
}

/** Idempotent: the second call heads the bucket and creates nothing — a delta, not a lifetime count. */
export async function assertSecondEnsureBucketMakesNoCreateCall(): Promise<void> {
  const { client, state } = makeFixture(CONFIGURED);
  await ensureBucket(client);
  const delta = await callsDuring(state, () => ensureBucket(client));
  assert(
    JSON.stringify(delta) === JSON.stringify(["headBucket:the-bucket"]),
    `expected the second ensureBucket to make only a headBucket call, got ${JSON.stringify(delta)}`,
  );
}

export async function assertEnsureBucketOnUnconfiguredClientIsANoop(): Promise<void> {
  const { client, state } = makeFixture(UNCONFIGURED);
  const delta = await callsDuring(state, () => ensureBucket(client));
  assert(delta.length === 0, `expected no S3 call for an unconfigured client, got ${JSON.stringify(delta)}`);
}

export const RACE_ERROR_NAMES = ["BucketAlreadyOwnedByYou", "BucketAlreadyExists"] as const;

/** A race with `api-replica` (decision 9): the bucket exists by the time `createBucket` lands, and that is success. */
export async function assertEnsureBucketSwallowsTheRaceError(name: string): Promise<void> {
  const { client, state } = makeFixture(CONFIGURED, namedError(name));
  let resolved = false;
  const delta = await callsDuring(state, async () => {
    await ensureBucket(client);
    resolved = true;
  });
  assert(resolved, `expected ensureBucket to resolve when createBucket throws ${name}`);
  assert(
    delta.includes("createBucket:the-bucket"),
    `positive control: createBucket must have been attempted, got ${JSON.stringify(delta)}`,
  );
}

export async function assertEnsureBucketRethrowsAnyOtherError(): Promise<void> {
  const { client } = makeFixture(CONFIGURED, namedError("AccessDenied"));
  const err = await captureRejection(() => ensureBucket(client));
  assert(
    errorName(err) === "AccessDenied",
    `expected the original error (AccessDenied) to be rethrown, got "${errorName(err)}"`,
  );
}

export async function assertGetObjectOnAMissingKeyReturnsNull(): Promise<void> {
  const { client } = makeFixture(CONFIGURED);
  const result = await getObject(client, KEY);
  assert(result === null, `expected null for a missing key, got ${JSON.stringify(result)}`);
}

export async function assertHeadObjectOnAMissingKeyReturnsNull(): Promise<void> {
  const { client } = makeFixture(CONFIGURED);
  const result = await headObject(client, KEY);
  assert(result === null, `expected null for a missing key, got ${JSON.stringify(result)}`);
}

export async function assertPutThenGetRoundTripsTheBytes(): Promise<void> {
  const { client } = makeFixture(CONFIGURED);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  await putObject(client, KEY, bytes, "image/png");
  const result = await getObject(client, KEY);
  assert(result !== null, "expected the object back after putObject");
  if (result === null) {
    return;
  }
  const read = await collect(result.body);
  assert(read.equals(bytes), `expected the same 9 bytes back, got ${read.toString("hex")}`);
  assert(result.contentLength === 9, `expected contentLength 9, got ${result.contentLength}`);
}

export async function assertHeadObjectReportsTheStoredLength(): Promise<void> {
  const { client } = makeFixture(CONFIGURED);
  await putObject(client, KEY, Buffer.alloc(17), "image/jpeg");
  const result = await headObject(client, KEY);
  assert(
    result !== null && result.contentLength === 17,
    `expected { contentLength: 17 }, got ${JSON.stringify(result)}`,
  );
}

export async function assertDeleteObjectRemovesTheKey(): Promise<void> {
  const { client } = makeFixture(CONFIGURED);
  await putObject(client, KEY, Buffer.from("x"), "image/webp");
  assert((await headObject(client, KEY)) !== null, "positive control: the object must exist before delete");
  await deleteObject(client, KEY);
  assert((await getObject(client, KEY)) === null, "expected getObject to return null after deleteObject");
}

/** Every bound operation reaches the fake with the client's bucket, never a caller-supplied one. */
export async function assertOperationsUseTheBoundBucket(): Promise<void> {
  const { client, state } = makeFixture(CONFIGURED);
  const delta = await callsDuring(state, async () => {
    await putObject(client, KEY, Buffer.from("x"), "image/png");
    await getObject(client, KEY);
    await headObject(client, KEY);
    await deleteObject(client, KEY);
  });
  const expected = [
    `putObject:the-bucket:${KEY}`,
    `getObject:the-bucket:${KEY}`,
    `headObject:the-bucket:${KEY}`,
    `deleteObject:the-bucket:${KEY}`,
  ];
  assert(
    JSON.stringify(delta) === JSON.stringify(expected),
    `expected the four calls against "the-bucket", got ${JSON.stringify(delta)}`,
  );
}

/** Exercised so the exported class is referenced from a test (dead-import guard). */
export function assertStorageUnavailableErrorNameIsStable(): void {
  const err = new StorageUnavailableError("x");
  assert(err.name === "StorageUnavailableError", `expected name "StorageUnavailableError", got "${err.name}"`);
}
