import { expect } from "vitest";

import {
  UPLINK_MAX_SAMPLES,
  UPLINK_TOKEN_PATTERN,
  uplinkBatchSchema,
  uplinkResponseSchema,
} from "./ingest";

/**
 * `E7.2` / ADR 0123 decision 4 — the uplink wire schema both ends parse.
 *
 * Assertions live here; `ingest-uplink.test.ts` is the vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it. Imported through `./ingest`
 * rather than `./ingest-uplink`, because the re-export is how the edge and the receiver reach it.
 */

const RX = "2026-11-10T09:00:00.000Z";

function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: "mqtt",
    deviceKey: "RTU-1",
    sourceKey: "flow",
    value: 12.5,
    at: "2026-11-10T08:59:59.000Z",
    rx: RX,
    good: true,
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    sentAt: "2026-11-10T09:00:01.000Z",
    backlog: false,
    buffered: 0,
    clock: "synced",
    samples: [sample()],
    ...overrides,
  };
}

/** The path of the first issue, joined, or `null` when the parse succeeded. */
function firstIssuePath(input: unknown): string | null {
  const result = uplinkBatchSchema.safeParse(input);
  return result.success ? null : result.error.issues[0].path.join(".");
}

/** A well-formed batch parses, and the sample keeps every field it carried. */
export function aGoodBatchParses(): void {
  const result = uplinkBatchSchema.safeParse(batch({ backlog: true, buffered: 42, clock: "unsynced" }));
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.samples[0]).toEqual(sample());
  expect(result.data.buffered).toBe(42);
  expect(result.data.clock).toBe("unsynced");
}

/** 500 samples is the cap: 500 parses, 501 is refused at `samples`. */
export function moreThanFiveHundredSamplesIsRefused(): void {
  expect(UPLINK_MAX_SAMPLES).toBe(500);
  const full = Array.from({ length: UPLINK_MAX_SAMPLES }, () => sample());
  expect(firstIssuePath(batch({ samples: full }))).toBeNull();
  expect(firstIssuePath(batch({ samples: [...full, sample()] }))).toBe("samples");
}

/** An empty batch carries nothing to write and is refused. */
export function anEmptyBatchIsRefused(): void {
  expect(firstIssuePath(batch({ samples: [] }))).toBe("samples");
}

/** `rx` is the row key (decision 8): a sample without it is refused. */
export function aMissingRxIsRefused(): void {
  const { rx: _rx, ...withoutRx } = sample();
  void _rx;
  expect(firstIssuePath(batch({ samples: [withoutRx] }))).toBe("samples.0.rx");
}

/** `deviceKey` is required on the wire (the edge stamps it on a one-device endpoint). */
export function aMissingDeviceKeyIsRefused(): void {
  const { deviceKey: _deviceKey, ...withoutKey } = sample();
  void _deviceKey;
  expect(firstIssuePath(batch({ samples: [withoutKey] }))).toBe("samples.0.deviceKey");
  expect(firstIssuePath(batch({ samples: [sample({ deviceKey: "" })] }))).toBe(
    "samples.0.deviceKey",
  );
}

/** Only version 1 exists; a later version is refused, not read as 1. */
export function anUnknownVersionIsRefused(): void {
  expect(firstIssuePath(batch({ v: 2 }))).toBe("v");
}

/** `at` is optional: a sample with no device time parses and stays without one. */
export function deviceTimeIsOptional(): void {
  const { at: _at, ...withoutAt } = sample();
  void _at;
  const result = uplinkBatchSchema.safeParse(batch({ samples: [withoutAt] }));
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect("at" in result.data.samples[0]).toBe(false);
}

/** The response names the four rejection buckets the receiver counts. */
export function theResponseCarriesFourRejectionBuckets(): void {
  const good = { accepted: 3, rejected: { foreignDevice: 1, futureRx: 0, tooOld: 0, unresolved: 2 } };
  expect(uplinkResponseSchema.safeParse(good).success).toBe(true);
  const { unresolved: _u, ...threeBuckets } = good.rejected;
  void _u;
  expect(uplinkResponseSchema.safeParse({ ...good, rejected: threeBuckets }).success).toBe(false);
}

/** The token pattern is `bmsgw_` and 43 base64url characters (256 bits), nothing else. */
export function theTokenPatternIsExact(): void {
  const body = "A".repeat(42) + "_";
  expect(UPLINK_TOKEN_PATTERN.test(`bmsgw_${body}`)).toBe(true);
  expect(UPLINK_TOKEN_PATTERN.test(`bmsgw_${body}x`)).toBe(false);
  expect(UPLINK_TOKEN_PATTERN.test(`bmsgw_${body.slice(1)}`)).toBe(false);
  expect(UPLINK_TOKEN_PATTERN.test(`bmsgw_${"A".repeat(42)}=`)).toBe(false);
  expect(UPLINK_TOKEN_PATTERN.test(`Bearer bmsgw_${body}`)).toBe(false);
}
