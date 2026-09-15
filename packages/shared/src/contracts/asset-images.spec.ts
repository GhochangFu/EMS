import {
  ASSET_IMAGE_CONTENT_TYPES,
  MAX_ASSET_IMAGE_BYTES,
  assetImageDtoSchema,
} from "./asset-images";
import { z } from "zod";
import { livenessResponseSchema, queueHealthSchema } from "./health";

type QueueHealth = z.infer<typeof queueHealthSchema>;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const UNCONFIGURED_QUEUE: QueueHealth = {
  configured: false,
  connected: false,
  queues: [],
  lastHeartbeatAt: null,
  heartbeatStale: false,
  lastRuleSweep: null,
};

const VALID_IMAGE = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  contentType: "image/png",
  byteSize: 1024,
  sha256: "a".repeat(64),
  originalFilename: "panel.png",
  caption: null,
  createdBy: null,
  createdAt: "2026-09-15T00:00:00.000Z",
};

/**
 * `F3.3` — the asset-image constants and the `storage` section on
 * `GET /health` (ADR 0066 decisions 3, 4, 7; Q-A).
 *
 * Assertions live here; `asset-images.test.ts` is the vitest entry point
 * (ADR 0014).
 */
export function assertContentTypesAreExactlyTheThree(): void {
  assert(
    JSON.stringify(ASSET_IMAGE_CONTENT_TYPES) ===
      JSON.stringify(["image/jpeg", "image/png", "image/webp"]),
    `ASSET_IMAGE_CONTENT_TYPES must be exactly the three types in order, got ${JSON.stringify(ASSET_IMAGE_CONTENT_TYPES)}`,
  );
}

export function assertMaxBytesIsTenMiB(): void {
  assert(
    MAX_ASSET_IMAGE_BYTES === 10485760,
    `MAX_ASSET_IMAGE_BYTES must be 10 MiB (10485760), got ${MAX_ASSET_IMAGE_BYTES}`,
  );
}

export function assertDtoRefusesObjectKey(): void {
  // Positive control first: the valid row, with no objectKey, must parse —
  // an absence check needs an adjacent positive (memory: an assertion can
  // miss the broken surface).
  const positive = assetImageDtoSchema.safeParse(VALID_IMAGE);
  assert(
    positive.success === true,
    `the valid asset-image row must parse, got ${JSON.stringify(positive.success === false ? positive.error.issues : null)}`,
  );

  const withKey = assetImageDtoSchema.safeParse({ ...VALID_IMAGE, objectKey: "org/x/assets/y/z" });
  assert(
    withKey.success === false,
    "assetImageDtoSchema must refuse a payload carrying objectKey (ADR 0066 decision 4) — the server-generated key never reaches a response DTO",
  );
}

export function assertStorageSectionIsOptionalOnLiveness(): void {
  const withoutStorage = livenessResponseSchema.safeParse({ status: "ok", queue: UNCONFIGURED_QUEUE });
  assert(
    withoutStorage.success === true,
    `livenessResponseSchema must accept a body with no storage key (the worker's shape, Q-A), got ${JSON.stringify(withoutStorage.success === false ? withoutStorage.error.issues : null)}`,
  );

  const withBadStorage = livenessResponseSchema.safeParse({
    status: "ok",
    queue: UNCONFIGURED_QUEUE,
    storage: { configured: "yes", reachable: false, bucket: null },
  });
  assert(
    withBadStorage.success === false,
    "livenessResponseSchema must refuse a malformed storage section",
  );
}
