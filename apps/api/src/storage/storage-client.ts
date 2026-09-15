import type { Logger } from "@nestjs/common";
import type { Readable } from "node:stream";

import type { StorageConfig } from "./storage-config";

/**
 * The storage client (ADR 0066 decisions 3, 4, 9) — the seam `F3.4` and
 * `E3.2` hang off.
 *
 * `S3Ops` is the six-operation interface the API needs from an S3
 * endpoint, and the only thing the rest of the API knows about the wire:
 * `aws-s3-ops.ts` implements it over `@aws-sdk/client-s3`, the specs
 * implement it in memory. `null` from `getObject`/`headObject` means "no
 * such object"; `"missing"` from `headBucket` means "no such bucket";
 * anything else throws through untouched, so a caller can read `err.name`.
 *
 * `createStorageClient` builds the one `StorageClient` from a
 * `StorageConfig`: **unconfigured** after one `warn` when the endpoint is
 * unset (the API boots, `GET /health` reports `configured: false`, the
 * asset image routes answer 503 — decision 3), or **configured** with the
 * bucket bound. The four bound operations take the client and a key and
 * never a bucket, so no caller can address a second one; on an
 * unconfigured client they reject with `StorageUnavailableError`.
 *
 * `ensureBucket` is decision 9's "the API creates the bucket at module
 * init when it is missing": `headBucket`, then `createBucket` only on
 * `"missing"`. `BucketAlreadyOwnedByYou` and `BucketAlreadyExists` from
 * `createBucket` are a race with `api-replica` and count as success; any
 * other error rethrows and refuses the boot. Idempotent — a second call
 * heads the bucket and creates nothing.
 *
 * Nothing in this file logs or throws the endpoint, a key or a secret
 * (AGENTS.md §9.6); the one warn names a variable, not a value.
 */

export type S3Ops = {
  headBucket(bucket: string): Promise<"ok" | "missing">;
  createBucket(bucket: string): Promise<void>;
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(bucket: string, key: string): Promise<{ body: Readable; contentLength: number | null } | null>;
  headObject(bucket: string, key: string): Promise<{ contentLength: number } | null>;
  deleteObject(bucket: string, key: string): Promise<void>;
};

export type StorageClient =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "configured"; readonly bucket: string; readonly ops: S3Ops };

export class StorageUnavailableError extends Error {
  override readonly name = "StorageUnavailableError";
}

/** The names S3 answers a `CreateBucket` that lost a race with; either means the bucket is there. */
const BUCKET_RACE_NAMES: ReadonlySet<string> = new Set(["BucketAlreadyOwnedByYou", "BucketAlreadyExists"]);

export function createStorageClient(
  config: StorageConfig,
  deps: {
    createOps: (config: Extract<StorageConfig, { kind: "configured" }>) => S3Ops;
    logger: Pick<Logger, "warn">;
  },
): StorageClient {
  if (config.kind === "unconfigured") {
    deps.logger.warn(
      "OBJECT_STORAGE_ENDPOINT missing; object storage unconfigured — asset image routes answer 503 (ADR 0066 decision 3)",
    );
    return { kind: "unconfigured" };
  }
  return { kind: "configured", bucket: config.bucket, ops: deps.createOps(config) };
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : "";
}

/** Decision 9: head, create only on `"missing"`, treat a lost race as success, rethrow anything else. No-op when unconfigured. */
export async function ensureBucket(client: StorageClient): Promise<void> {
  if (client.kind === "unconfigured") {
    return;
  }
  const verdict = await client.ops.headBucket(client.bucket);
  if (verdict === "ok") {
    return;
  }
  try {
    await client.ops.createBucket(client.bucket);
  } catch (err) {
    if (!BUCKET_RACE_NAMES.has(errorName(err))) {
      throw err;
    }
  }
}

/** Decision 3: an unconfigured client rejects by name; the message names the variable, never a value. */
function requireConfigured(
  client: StorageClient,
  operation: string,
): Extract<StorageClient, { kind: "configured" }> {
  if (client.kind === "unconfigured") {
    throw new StorageUnavailableError(
      `${operation}: OBJECT_STORAGE_ENDPOINT is not configured, so object storage is unavailable (ADR 0066 decision 3)`,
    );
  }
  return client;
}

export async function putObject(
  client: StorageClient,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const bound = requireConfigured(client, "putObject");
  await bound.ops.putObject(bound.bucket, key, body, contentType);
}

export async function getObject(
  client: StorageClient,
  key: string,
): Promise<{ body: Readable; contentLength: number | null } | null> {
  const bound = requireConfigured(client, "getObject");
  return bound.ops.getObject(bound.bucket, key);
}

export async function headObject(
  client: StorageClient,
  key: string,
): Promise<{ contentLength: number } | null> {
  const bound = requireConfigured(client, "headObject");
  return bound.ops.headObject(bound.bucket, key);
}

export async function deleteObject(client: StorageClient, key: string): Promise<void> {
  const bound = requireConfigured(client, "deleteObject");
  await bound.ops.deleteObject(bound.bucket, key);
}
