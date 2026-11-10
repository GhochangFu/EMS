import { UPLINK_MAX_AGE_MS, UPLINK_MAX_FUTURE_MS, type UplinkBatch, type UplinkSample } from "@bms/shared/ingest";

import { assert } from "./normaliser.spec.js";
import { screenBatch } from "./uplink-receiver.js";

/**
 * `E7.2` / ADR 0123 decisions 5 and 8 (cloud guard), plan T3.2 and P10 (a) —
 * what the receiver lets through to `resolveSamples`, before any database work.
 *
 * Assertions live here; `uplink-receiver-screen.test.ts` is the vitest entry
 * point (ADR 0014). One exported function per guard, so a mutation of one
 * guard reddens exactly the `it()` that owns it.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const MINE = new Set(["RTU-MINE"]);

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function sampleOf(overrides: Partial<UplinkSample> = {}): UplinkSample {
  return { protocol: "mqtt", sourceKey: "s1", value: 1, deviceKey: "RTU-MINE", rx: at(-1_000), ...overrides };
}

function batchOf(...samples: UplinkSample[]): UplinkBatch {
  return { v: 1, sentAt: NOW.toISOString(), backlog: false, buffered: 0, clock: "synced", samples };
}

/** A `deviceKey` that is not one of the gateway's RTUs is counted and never passed on. */
export function aForeignDeviceIsCountedAndDropped(): void {
  const result = screenBatch(batchOf(sampleOf(), sampleOf({ deviceKey: "RTU-OTHER" })), MINE, NOW);
  assert(result.rejected.foreignDevice === 1, `foreignDevice must be 1, got ${result.rejected.foreignDevice}`);
  assert(result.samples.length === 1, `one sample must pass, got ${result.samples.length}`);
  assert(
    result.samples.every((s) => s.sample.deviceKey === "RTU-MINE"),
    "a foreign device's sample must never reach resolveSamples",
  );
  // A gateway with no RTUs assigned (P10 a: deployed before assignment).
  const none = screenBatch(batchOf(sampleOf()), new Set(), NOW);
  assert(none.rejected.foreignDevice === 1 && none.samples.length === 0, "no RTUs: every sample is foreign");
}

/** `rx` exactly 60 s ahead passes; 60 001 ms ahead is `futureRx`. */
export function rxMoreThanSixtySecondsAheadIsFutureRx(): void {
  const edge = screenBatch(batchOf(sampleOf({ rx: at(UPLINK_MAX_FUTURE_MS) })), MINE, NOW);
  assert(edge.rejected.futureRx === 0 && edge.samples.length === 1, "rx exactly 60 s ahead must pass");
  const past = screenBatch(batchOf(sampleOf({ rx: at(UPLINK_MAX_FUTURE_MS + 1) })), MINE, NOW);
  assert(past.rejected.futureRx === 1, `rx 60 001 ms ahead must count futureRx, got ${past.rejected.futureRx}`);
  assert(past.samples.length === 0, "a futureRx sample must not pass");
}

/** `rx` exactly 6 d 12 h old passes; 1 ms older is `tooOld`. */
export function rxOlderThanTheCeilingIsTooOld(): void {
  const edge = screenBatch(batchOf(sampleOf({ rx: at(-UPLINK_MAX_AGE_MS) })), MINE, NOW);
  assert(edge.rejected.tooOld === 0 && edge.samples.length === 1, "rx exactly 6 d 12 h old must pass");
  const past = screenBatch(batchOf(sampleOf({ rx: at(-UPLINK_MAX_AGE_MS - 1) })), MINE, NOW);
  assert(past.rejected.tooOld === 1, `rx 1 ms past the ceiling must count tooOld, got ${past.rejected.tooOld}`);
  assert(past.samples.length === 0, "a tooOld sample must not pass");
}

/** `rx` becomes `receivedAt` unchanged — the edge's arrival, not the cloud's (ADR 0061 Amendment 4). */
export function rxBecomesReceivedAtUnchanged(): void {
  const rx = "2026-11-10T05:12:34.567Z";
  const result = screenBatch(batchOf(sampleOf({ rx })), MINE, NOW);
  assert(result.samples.length === 1, "the sample must pass");
  assert(
    result.samples[0].receivedAt.toISOString() === rx,
    `receivedAt must be rx, got ${result.samples[0].receivedAt.toISOString()}`,
  );
}

/** `at`, `good`, `sourceKey`, `value` and `deviceKey` are kept; an absent `at` stays absent. */
export function theSampleFieldsAreKept(): void {
  const deviceAt = "2026-11-10T08:59:00.000Z";
  const result = screenBatch(
    batchOf(sampleOf({ at: deviceAt, good: false, value: -0, sourceKey: "kwh" }), sampleOf({ sourceKey: "kw" })),
    MINE,
    NOW,
  );
  const [withAt, withoutAt] = result.samples;
  assert(withAt.sample.at instanceof Date && withAt.sample.at.toISOString() === deviceAt, "at must be kept as a Date");
  assert(withAt.sample.good === false, "good must be kept");
  assert(Object.is(withAt.sample.value, -0) && withAt.sample.sourceKey === "kwh", "value and sourceKey kept");
  assert(withAt.sample.deviceKey === "RTU-MINE", "deviceKey kept");
  assert(!("at" in withoutAt.sample), "an absent at must stay absent, never filled with rx");
  assert(!("good" in withoutAt.sample), "an absent good must stay absent");
}

/** The guards run in a fixed order: a foreign sample is counted foreign, whatever its rx. */
export function aForeignSampleIsCountedOnce(): void {
  const result = screenBatch(
    batchOf(sampleOf({ deviceKey: "RTU-OTHER", rx: at(UPLINK_MAX_FUTURE_MS + 5_000) })),
    MINE,
    NOW,
  );
  const { foreignDevice, futureRx, tooOld } = result.rejected;
  assert(foreignDevice === 1 && futureRx === 0 && tooOld === 0, "one sample, one reason: foreignDevice");
}
