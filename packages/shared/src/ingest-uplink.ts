import { z } from "zod";

import { INGEST_PROTOCOLS } from "./ingest-protocols";

/**
 * The edge-to-cloud uplink wire (`E7.2`, ADR 0123 decision 4).
 *
 * One definition both ends parse: the edge's uplink client builds a body that
 * satisfies `uplinkBatchSchema`, and the cloud receiver refuses one that does
 * not. Re-exported from `./ingest` — the shared barrel is at the AGENTS.md
 * §4.5 cap, and both consumers already load the `./ingest` subpath.
 *
 * **Not an API response.** The receiver lives in `apps/ingest`, not behind
 * `apps/api`'s OpenAPI registry, so ADR 0030's contract registry does not
 * apply; the types are still `z.infer` of these schemas so they cannot drift
 * from what is parsed. Plain `z.object`, so unknown keys are stripped rather
 * than refused — a newer edge adding a field must not have every batch
 * refused by an older cloud.
 *
 * A sample is the disk buffer's segment line (`lineSchema` in
 * `apps/ingest/src/host/disk-buffer.ts`) plus `protocol`, with `deviceKey`
 * **required**: the drain loop stamps a device key only on spill, so the edge
 * client stamps it on a live batch from a one-device endpoint, and the cloud
 * never has to guess (plan M5). `tests/e7.2-uplink-wire-parity.test.ts` holds
 * the two key sets equal.
 */

/** Samples per batch. The edge splits anything larger; the cloud refuses it. */
export const UPLINK_MAX_SAMPLES = 500;
/** Compressed (gzip) body bytes the receiver reads before it answers 413. */
export const UPLINK_MAX_BODY_BYTES = 262_144;
/** Decoded bytes the receiver inflates before it answers 413 (a gzip bomb stops here). */
export const UPLINK_MAX_DECODED_BYTES = 1_048_576;
/** How far ahead of the cloud's clock a sample's `rx` may be (decision 8, cloud guard). */
export const UPLINK_MAX_FUTURE_MS = 60_000;
/**
 * How old a sample's `rx` may be: 6 d 12 h. The edge's buffer ceiling is 6 d
 * (decision 7); the 12 h margin covers a batch that sat at that ceiling while
 * its uplink was failing, without letting anything reach a compressed chunk.
 */
export const UPLINK_MAX_AGE_MS = 6 * 86_400_000 + 12 * 3_600_000;
/** A gateway token: `bmsgw_` and 43 base64url characters — 256 random bits (decision 5). */
export const UPLINK_TOKEN_PATTERN = /^bmsgw_[A-Za-z0-9_-]{43}$/;

/** The edge's clock state, as its clock guard reports it (decision 8). */
export const UPLINK_CLOCK_STATES = ["synced", "unsynced"] as const;

export const uplinkSampleSchema = z.object({
  protocol: z.enum(INGEST_PROTOCOLS),
  sourceKey: z.string().min(1),
  value: z.number(),
  deviceKey: z.string().min(1),
  /** Device time, ISO 8601 UTC, only when the device carried a readable one. */
  at: z.string().datetime().optional(),
  /** Receive time the edge stamped, ISO 8601 UTC — becomes the row's `time`. */
  rx: z.string().datetime(),
  good: z.boolean().optional(),
});

export type UplinkSample = z.infer<typeof uplinkSampleSchema>;

export const uplinkBatchSchema = z.object({
  v: z.literal(1),
  /** When the edge sent this body, on its own clock. */
  sentAt: z.string().datetime(),
  /** `true` when the oldest sample is more than 10 s old on the edge clock (plan C3). */
  backlog: z.boolean(),
  /** Samples the edge holds on disk at send time (`bms.edge_gateways.reported_backlog`). */
  buffered: z.number().int().nonnegative(),
  clock: z.enum(UPLINK_CLOCK_STATES),
  samples: z.array(uplinkSampleSchema).min(1).max(UPLINK_MAX_SAMPLES),
});

export type UplinkBatch = z.infer<typeof uplinkBatchSchema>;

/**
 * Every refusal the receiver answers, with its status. The body of a refusal
 * is exactly `{ "error": <code> }`. One definition for both ends: the
 * receiver (`uplink-server.ts`) answers from it, and the edge client treats a
 * `400`/`413` as final **only** when its body carries one of these codes with
 * that status — a proxy's error page with the same status is retried, never
 * taken as the receiver refusing the data (ADR 0123 Amendment 2).
 */
export const UPLINK_REFUSAL_STATUS = {
  "not-found": 404,
  method: 405,
  unauthorized: 401,
  "gateway-revoked": 403,
  "ingest-disabled": 403,
  busy: 429,
  overloaded: 429,
  "rate-limited": 429,
  "bad-encoding": 400,
  "too-large": 413,
  "bad-gzip": 400,
  "bad-json": 400,
  "bad-schema": 400,
} as const;

export type UplinkRefusal = keyof typeof UPLINK_REFUSAL_STATUS;

export const UPLINK_REFUSAL_CODES = Object.keys(UPLINK_REFUSAL_STATUS) as readonly UplinkRefusal[];

const count = z.number().int().nonnegative();

/**
 * The `200` body. **The units differ:** `accepted` is rows written (a sample
 * that fans out to two points counts 2, two samples collapsed onto one stored
 * key count 1); `foreignDevice`, `futureRx` and `tooOld` are samples;
 * `unresolved` is refused writes as the normaliser's `droppedCount` sums them,
 * so a sample refused for two of its targets counts 2.
 */
export const uplinkResponseSchema = z.object({
  accepted: count,
  rejected: z.object({
    foreignDevice: count,
    futureRx: count,
    tooOld: count,
    unresolved: count,
  }),
});

export type UplinkResponse = z.infer<typeof uplinkResponseSchema>;
