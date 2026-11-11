import { DROP_REASONS, type SourceSample } from "@bms/shared/ingest";

import {
  cleanLabel,
  type DropTally,
  droppedCount,
  type PointIndex,
  type PointTarget,
  resolveSamples,
  type ResolveResult,
} from "./normaliser.js";
import type { ReceivedSample } from "./received-sample.js";

/**
 * `F3.16` / ADR 0127 decisions 8 and 9 — the attribution `resolveSamples`
 * returns beside `counters`: per device, per reason, the count and the first
 * point dropped; the newest receive time; the clock skew; and the drops that
 * belong to no RTU.
 *
 * Its own file rather than more blocks in `normaliser.spec.ts`, which sits at
 * 797 lines against the §4.5 cap. `counters` itself is not re-tested here: the
 * whole-object assertions in that file are what hold it unchanged.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const T0 = new Date("2026-11-11T10:00:00.000Z");
const T1 = new Date("2026-11-11T10:00:05.000Z");
const T2 = new Date("2026-11-11T10:00:09.000Z");

function target(assetId: string, pointKey: string, metadata: Partial<PointTarget> = {}): PointTarget {
  return {
    assetId,
    pointKey,
    unit: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...metadata,
  };
}

const INDEX: PointIndex = new Map([
  [
    "RTU-1",
    new Map([
      ["flow", [target("asset-a", "FLOW")]],
      ["press", [target("asset-a", "PRESS")]],
      ["level", [target("asset-a", "LEVEL", { engMin: 0, engMax: 10 })]],
      ["huge", [target("asset-a", "HUGE", { scaleMultiplier: 1e308 })]],
      // One source key, two targets: only the second has a band.
      ["shared", [target("asset-a", "SHARED"), target("asset-b", "SHARED_B", { engMax: 5 })]],
    ]),
  ],
  ["RTU-2", new Map([["flow", [target("asset-c", "FLOW")]]])],
]);

function at(receivedAt: Date, sample: SourceSample): ReceivedSample {
  return { sample, receivedAt };
}

function tally(result: ResolveResult, deviceKey: string, reason: (typeof DROP_REASONS)[number]): DropTally {
  const entry = result.devices.get(deviceKey)?.drops[reason];
  if (entry === undefined) {
    throw new Error(`no ${reason} tally for ${deviceKey}: ${JSON.stringify([...result.devices.keys()])}`);
  }
  return entry;
}

/** Sum of every attributed and unattributed tally; must equal `droppedCount`. */
function attributedTotal(result: ResolveResult): number {
  let total = 0;
  for (const device of result.devices.values()) {
    for (const reason of DROP_REASONS) {
      total += device.drops[reason]?.count ?? 0;
    }
  }
  for (const reason of DROP_REASONS) {
    total += result.unattributed[reason]?.count ?? 0;
  }
  return total;
}

/** One case per reason: the first point is named and stays named when a second drop follows. */
export function runFirstDropPerReasonTests(): void {
  // badQuality: discard_bad on two points; the first named is the first dropped.
  const bad = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: "flow", value: 1, good: false }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "press", value: 1, good: false }),
    ],
    INDEX,
  );
  const badTally = tally(bad, "RTU-1", "badQuality");
  assert(badTally.count === 2, `badQuality counts 2, got ${badTally.count}`);
  assert(
    badTally.first.assetId === "asset-a" && badTally.first.pointKey === "FLOW" && badTally.first.sourceKey === "flow",
    `badQuality names the first point: ${JSON.stringify(badTally.first)}`,
  );
  assert(badTally.first.deviceKey === "RTU-1", "the first drop carries its device key");
  assert(badTally.firstAt.getTime() === T0.getTime(), "the first drop carries its receive time");
  assert(bad.firstDropped.badQuality?.pointKey === "FLOW", "firstDropped names the same point");

  // outOfRange: two out-of-band readings; the first stays named.
  const range = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: "level", value: 11 }),
      at(T1, { deviceKey: "RTU-1", sourceKey: "level", value: -1 }),
    ],
    INDEX,
  );
  const rangeTally = tally(range, "RTU-1", "outOfRange");
  assert(rangeTally.count === 2 && rangeTally.first.pointKey === "LEVEL", `outOfRange: ${JSON.stringify(rangeTally)}`);
  assert(rangeTally.firstAt.getTime() === T0.getTime(), "the first out-of-range drop keeps its receive time");

  // nonFinite, raw: names the source key and no asset; post-scale: names the point.
  const raw = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: "flow", value: Number.NaN }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "huge", value: 1e10 }),
    ],
    INDEX,
  );
  const rawTally = tally(raw, "RTU-1", "nonFinite");
  assert(rawTally.count === 2, `nonFinite counts both, got ${rawTally.count}`);
  assert(
    rawTally.first.assetId === null && rawTally.first.pointKey === null && rawTally.first.sourceKey === "flow",
    `a raw non-finite names the source key only: ${JSON.stringify(rawTally.first)}`,
  );
  const scaled = resolveSamples([at(T0, { deviceKey: "RTU-1", sourceKey: "huge", value: 1e10 })], INDEX);
  assert(
    tally(scaled, "RTU-1", "nonFinite").first.pointKey === "HUGE" &&
      tally(scaled, "RTU-1", "nonFinite").first.assetId === "asset-a",
    "a post-scale non-finite names the point",
  );

  // unmappedSourceKey: the source key, no asset, no point.
  const unmapped = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: "ghost", value: 1 }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "other", value: 1 }),
    ],
    INDEX,
  );
  const unmappedTally = tally(unmapped, "RTU-1", "unmappedSourceKey");
  assert(unmappedTally.count === 2, `unmapped counts 2, got ${unmappedTally.count}`);
  assert(
    unmappedTally.first.sourceKey === "ghost" &&
      unmappedTally.first.assetId === null &&
      unmappedTally.first.pointKey === null,
    `unmappedSourceKey names the source key and no asset: ${JSON.stringify(unmappedTally.first)}`,
  );
}

/** A fan-out sample refused for one target names that target, and the other is written. */
export function runFanOutAttributionTests(): void {
  const result = resolveSamples([at(T0, { deviceKey: "RTU-1", sourceKey: "shared", value: 7 })], INDEX);
  assert(result.rows.length === 1 && result.rows[0].assetId === "asset-a", "the in-band target is written");
  const range = tally(result, "RTU-1", "outOfRange");
  assert(
    range.count === 1 && range.first.assetId === "asset-b" && range.first.pointKey === "SHARED_B",
    `the refused target is named: ${JSON.stringify(range.first)}`,
  );
}

/** `unknownDevice` and `ambiguousDevice` land in `unattributed`, never in `devices`. */
export function runUnattributedTests(): void {
  const unknown = resolveSamples(
    [
      at(T0, { deviceKey: "STRANGER", sourceKey: "flow", value: 1 }),
      at(T1, { deviceKey: "OTHER", sourceKey: "kw", value: 1 }),
    ],
    INDEX,
  );
  assert(unknown.devices.size === 0, `an unknown device is not a device: ${JSON.stringify([...unknown.devices.keys()])}`);
  const u = unknown.unattributed.unknownDevice;
  assert(u?.count === 2, `unknownDevice counts 2, got ${u?.count}`);
  assert(u?.first.deviceKey === "STRANGER" && u.first.sourceKey === "flow", `first device key and source key: ${JSON.stringify(u?.first)}`);
  assert(u?.first.assetId === null && u.first.pointKey === null, "no asset for a device with no binding");

  // Several bindings and no deviceKey: ambiguous, with no device key to name.
  const ambiguous = resolveSamples([at(T0, { sourceKey: "flow", value: 1 })], INDEX, undefined);
  const a = ambiguous.unattributed.ambiguousDevice;
  assert(a?.count === 1 && a.first.deviceKey === null && a.first.sourceKey === "flow", `ambiguous: ${JSON.stringify(a)}`);
  assert(ambiguous.devices.size === 0, "an ambiguous sample belongs to no device");

  // A raw non-finite from a device with no binding has no RTU either.
  const strayNaN = resolveSamples([at(T0, { deviceKey: "STRANGER", sourceKey: "flow", value: Number.NaN })], INDEX);
  assert(strayNaN.unattributed.nonFinite?.count === 1, "a raw non-finite from an unknown device is unattributed");
  assert(strayNaN.devices.size === 0, "and is in no device");

  // A sole device key attributes an omitted deviceKey.
  const sole = resolveSamples([at(T0, { sourceKey: "ghost", value: 1 })], INDEX, "RTU-2");
  assert(tally(sole, "RTU-2", "unmappedSourceKey").first.deviceKey === "RTU-2", "the sole device key is named");
}

/** `lastReceivedAt` is the maximum receive time, a dropped sample included; `skew` from the newest with a device time. */
export function runLastSeenAndSkewTests(): void {
  const result = resolveSamples(
    [
      at(T1, { deviceKey: "RTU-1", sourceKey: "flow", value: 1, at: new Date(T1.getTime() + 120_000) }),
      // The newest sample is dropped (unmapped) and still moves last-seen and skew.
      at(T2, { deviceKey: "RTU-1", sourceKey: "ghost", value: 1, at: new Date(T2.getTime() - 30_000) }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "press", value: 1, at: new Date(T0.getTime() + 999_000) }),
      at(T0, { deviceKey: "RTU-2", sourceKey: "flow", value: 1 }),
    ],
    INDEX,
  );
  const one = result.devices.get("RTU-1");
  assert(one?.lastReceivedAt.getTime() === T2.getTime(), `lastReceivedAt is the max: ${one?.lastReceivedAt.toISOString()}`);
  assert(
    one?.skew?.receivedAt.getTime() === T2.getTime() && one.skew.deviceTime.getTime() === T2.getTime() - 30_000,
    `skew is the newest sample's: ${JSON.stringify(one?.skew)}`,
  );
  const two = result.devices.get("RTU-2");
  assert(two?.lastReceivedAt.getTime() === T0.getTime(), "RTU-2 is seen at T0");
  assert(two?.skew === null, "no device time anywhere: skew is null");

  // An unreadable `at` is no device time.
  const invalid = resolveSamples([at(T0, { deviceKey: "RTU-2", sourceKey: "flow", value: 1, at: new Date(Number.NaN) })], INDEX);
  assert(invalid.devices.get("RTU-2")?.skew === null, "an Invalid Date gives no skew");
}

/** The tallies account for every drop: devices plus unattributed equals `droppedCount`. */
export function runAttributionSumTests(): void {
  const result = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: "flow", value: 1, good: false }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "flow", value: Number.NaN }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "level", value: 99 }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "shared", value: 9 }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "ghost", value: 1 }),
      at(T0, { deviceKey: "RTU-2", sourceKey: "ghost", value: 1 }),
      at(T0, { deviceKey: "STRANGER", sourceKey: "x", value: 1 }),
      at(T0, { deviceKey: "STRANGER", sourceKey: "x", value: Number.POSITIVE_INFINITY }),
      at(T0, { sourceKey: "flow", value: 1 }),
      at(T0, { deviceKey: "RTU-1", sourceKey: "press", value: 3 }),
    ],
    INDEX,
  );
  const dropped = droppedCount(result.counters);
  assert(dropped === 9, `nine refused writes, got ${dropped}`);
  assert(attributedTotal(result) === dropped, `attributed ${attributedTotal(result)} must equal droppedCount ${dropped}`);
  for (const reason of DROP_REASONS) {
    const first = result.firstDropped[reason];
    assert(first !== undefined, `firstDropped names ${reason}`);
  }
  const clean = resolveSamples([at(T0, { deviceKey: "RTU-1", sourceKey: "flow", value: 1 })], INDEX);
  assert(Object.keys(clean.firstDropped).length === 0, "nothing dropped: firstDropped is empty");
  assert(Object.keys(clean.unattributed).length === 0, "nothing dropped: unattributed is empty");
}

/** Device-supplied strings are cut to 128 characters and lose their control characters (decision 8). */
export function runDeviceStringCleaningTests(): void {
  const long = "k".repeat(200);
  const result = resolveSamples(
    [
      at(T0, { deviceKey: "RTU-1", sourceKey: `${long}`, value: 1 }),
      at(T0, { deviceKey: "EVIL\nKEY\u0007", sourceKey: "a\r\nb", value: 1 }),
    ],
    INDEX,
  );
  const first = tally(result, "RTU-1", "unmappedSourceKey").first;
  assert(first.sourceKey?.length === 128, `cut to 128, got ${first.sourceKey?.length}`);
  const stray = result.unattributed.unknownDevice?.first;
  assert(stray?.deviceKey === "EVILKEY" && stray.sourceKey === "ab", `control characters stripped: ${JSON.stringify(stray)}`);
  assert(cleanLabel("\u{1F600}".repeat(130))?.length === 256, "the cut counts code points, never splitting a pair");
  assert(cleanLabel(null) === null, "null stays null");
}
