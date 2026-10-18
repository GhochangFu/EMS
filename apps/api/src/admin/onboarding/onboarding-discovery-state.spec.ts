import type { OnboardingDiscoveryStored } from "@bms/shared";
import { expect } from "vitest";

import { discoveryIsBusy, readDiscovery, readStoredDiscovery, withDiscoveryOf } from "./onboarding-discovery-state";

/**
 * F3.24b — `readDiscovery` maps the stored shape to the DTO and fails closed (U1);
 * the busy rule and the locked-write carry of `_discovery` (U3). Entry: the sibling `.test.ts`.
 */

const STORED: OnboardingDiscoveryStored = {
  discoveryId: "11111111-1111-4111-8111-111111111111",
  rtuCode: "R1",
  topicFilter: "a/#",
  windowSeconds: 60,
  status: "queued",
  startedAt: null,
  finishedAt: null,
  truncated: false,
  devices: [],
  queuedAt: "2026-10-18T00:00:00.000Z",
  messages: 0,
  skipped: 0,
};

export function aStoredDiscoveryReadsAsTheDto(): void {
  const dto = readDiscovery({ _discovery: STORED });
  expect(dto?.discoveryId).toBe(STORED.discoveryId);
  expect(dto).not.toHaveProperty("queuedAt");
}

export function aMalformedBlobReadsAsNull(): void {
  expect(readDiscovery({ _discovery: { ...STORED, status: "weird" } })).toBeNull();
}

export function anAbsentKeyReadsAsNull(): void {
  expect(readDiscovery({})).toBeNull();
}

const NOW = Date.parse("2026-10-18T12:00:00.000Z");

/** Decisions #7: the worker runs one job at a time across tenants, so `queued` has no stale bound. */
export function anOldQueuedDiscoveryIsBusy(): void {
  expect(discoveryIsBusy({ ...STORED, status: "queued", queuedAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(true);
}

/** `running` is busy until `startedAt + windowSeconds + 60 s`. */
export function aRunningDiscoveryInsideItsBoundIsBusy(): void {
  const startedAt = new Date(NOW - (60 + 60) * 1000 + 1).toISOString();
  expect(discoveryIsBusy({ ...STORED, status: "running", startedAt }, NOW)).toBe(true);
}

export function aRunningDiscoveryPastItsBoundIsNotBusy(): void {
  const startedAt = new Date(NOW - (60 + 60) * 1000 - 1).toISOString();
  expect(discoveryIsBusy({ ...STORED, status: "running", startedAt }, NOW)).toBe(false);
}

export function aRunningDiscoveryWithNoStartIsBusy(): void {
  expect(discoveryIsBusy({ ...STORED, status: "running", startedAt: null }, NOW)).toBe(true);
}

export function aFinishedDiscoveryIsNotBusy(): void {
  expect(discoveryIsBusy({ ...STORED, status: "done" }, NOW)).toBe(false);
  expect(discoveryIsBusy({ ...STORED, status: "failed" }, NOW)).toBe(false);
}

export function noDiscoveryIsNotBusy(): void {
  expect(discoveryIsBusy(null, NOW)).toBe(false);
}

export function aStoredBlobReadsWithItsStoredOnlyKeys(): void {
  expect(readStoredDiscovery({ _discovery: STORED })?.queuedAt).toBe(STORED.queuedAt);
  expect(readStoredDiscovery({ _discovery: { ...STORED, status: "weird" } })).toBeNull();
}

/** The locked row's `_discovery` wins over the one the turn read before the lock (a worker wrote between). */
export function withDiscoveryOfTakesTheLockedRowsResult(): void {
  const locked = { rtus: [], _discovery: { ...STORED, status: "done" } };
  const merged = { rtus: [{ code: "R1" }], _discovery: STORED };
  const out = withDiscoveryOf(locked, merged) as Record<string, unknown>;
  expect(out._discovery).toEqual(locked._discovery);
  expect(out.rtus).toEqual(merged.rtus);
}

export function withDiscoveryOfAddsTheLockedRowsResultWhenTheMergeHasNone(): void {
  const out = withDiscoveryOf({ _discovery: STORED }, { rtus: [] }) as Record<string, unknown>;
  expect(out._discovery).toEqual(STORED);
}

/** A locked row with no discovery drops one the merged draft carried. */
export function withDiscoveryOfDropsAResultTheLockedRowLacks(): void {
  const out = withDiscoveryOf({ rtus: [] }, { rtus: [], _discovery: STORED }) as Record<string, unknown>;
  expect(out).not.toHaveProperty("_discovery");
  expect(out).toHaveProperty("rtus");
}

export function withDiscoveryOfLeavesTheMergedDraftUntouched(): void {
  const merged = { rtus: [] };
  withDiscoveryOf({ _discovery: STORED }, merged);
  expect(merged).not.toHaveProperty("_discovery");
}
