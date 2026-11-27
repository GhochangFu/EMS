import { expect } from "vitest";

import { POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MIN_MS, pollIntervalMsSchema } from "./ingest-poll-interval";

/**
 * `F1.2` / ADR 0141 decision 10 — the one poll interval bound.
 *
 * Assertions live here; `ingest-poll-interval.test.ts` is the vitest entry
 * point (ADR 0014). The host, both API bodies, the migration's static test and
 * the web forms read this schema, so its bounds are pinned as numbers.
 */

export function assertTheBoundsAreOneSecondAndOneHour(): void {
  expect(POLL_INTERVAL_MIN_MS).toBe(1_000);
  expect(POLL_INTERVAL_MAX_MS).toBe(3_600_000);
}

export function assertBothBoundsAreAccepted(): void {
  expect(pollIntervalMsSchema.safeParse(1_000).success).toBe(true);
  expect(pollIntervalMsSchema.safeParse(3_600_000).success).toBe(true);
  expect(pollIntervalMsSchema.parse(60_000)).toBe(60_000);
}

export function assertOneBelowTheFloorIsRefused(): void {
  expect(pollIntervalMsSchema.safeParse(999).success).toBe(false);
}

export function assertOneAboveTheCeilingIsRefused(): void {
  expect(pollIntervalMsSchema.safeParse(3_600_001).success).toBe(false);
}

export function assertANonIntegerAStringAndNullAreRefused(): void {
  for (const value of [1.5, 1_000.5, "10000", null, undefined, Number.NaN]) {
    expect(pollIntervalMsSchema.safeParse(value).success, `${String(value)} should be refused`).toBe(false);
  }
}
