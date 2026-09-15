import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

import type { S3Ops } from "./storage-client";
import type { StorageConfig } from "./storage-config";

/**
 * `S3Ops` over `@aws-sdk/client-s3` (ADR 0066 decision 2) — the only file
 * in the API that imports the SDK. Six commands, one per operation.
 *
 * **The "missing" mapping is MEASURED, not assumed.**
 * `storage.integration.spec.ts` drives the raw SDK against MinIO
 * `RELEASE.2025-09-07T16-13-09Z` (`@aws-sdk/client-s3` 3.1132.0) and reads
 * the names back, 2026-09-15:
 *
 * | call | key/bucket | `err.name` | `err.Code` | `$metadata.httpStatusCode` |
 * |---|---|---|---|---|
 * | `GetObject` | absent key | `NoSuchKey` | `NoSuchKey` | 404 |
 * | `HeadObject` | absent key | `NotFound` | *(none)* | 404 |
 * | `HeadBucket` | absent bucket | `NotFound` | *(none)* | 404 |
 * | `GetObject` | absent bucket | `NoSuchBucket` | `NoSuchBucket` | 404 |
 * | `CreateBucket` | existing bucket, same owner | `BucketAlreadyOwnedByYou` | `BucketAlreadyOwnedByYou` | 409 |
 *
 * The `CreateBucket` row is the lost-race name `ensureBucket` swallows
 * (`BUCKET_RACE_NAMES` in `storage-client.ts`); `BucketAlreadyExists` is the
 * other-owner name AWS documents and MinIO did not produce here, kept in the
 * set for a hosted S3. The two HEADs carry no `Code` because the response has no body — that is
 * why the name arm cannot be replaced by a `Code` check. The
 * `$metadata.httpStatusCode === 404` arm stays as the catch for a server
 * that names the error differently; every measured case above matches a
 * name arm as well, so no case depends on it alone.
 *
 * **What this map must NOT swallow**, measured in the same run: a client
 * with a wrong secret answers `SignatureDoesNotMatch` / **403**, and that
 * has to keep throwing. Widened to "any error is missing", the integration
 * suite's wrong-credentials row is the one that reddens — an authentication
 * failure would otherwise reach the operator as an image that does not
 * exist.
 *
 * Wiring, uncovered like `main.ts`; Unit 7's integration spec runs it in
 * CI. **Nothing here logs or throws the endpoint or a credential**
 * (AGENTS.md §9.6): an SDK error passes through with its own `name` and
 * `message`, which the SDK builds from the service response, not from the
 * client's configuration.
 */

type ConfiguredStorage = Extract<StorageConfig, { kind: "configured" }>;

function isMissing(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const { name, $metadata } = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    name === "NotFound" ||
    name === "NoSuchKey" ||
    name === "NoSuchBucket" ||
    $metadata?.httpStatusCode === 404
  );
}

export function createAwsS3Ops(config: ConfiguredStorage): S3Ops {
  const client = new S3Client({
    endpoint: config.endpoint.toString(),
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    headBucket: async (bucket) => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return "ok";
      } catch (err) {
        if (isMissing(err)) {
          return "missing";
        }
        throw err;
      }
    },
    createBucket: async (bucket) => {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    },
    putObject: async (bucket, key, body, contentType) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      );
    },
    getObject: async (bucket, key) => {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (out.Body === undefined) {
          return null;
        }
        // Under the Node runtime `Body` is `SdkStream<IncomingMessage | Readable>`;
        // both are `Readable`, and the mixin adds only helper methods.
        return { body: out.Body as unknown as Readable, contentLength: out.ContentLength ?? null };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    headObject: async (bucket, key) => {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { contentLength: out.ContentLength ?? 0 };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    deleteObject: async (bucket, key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
