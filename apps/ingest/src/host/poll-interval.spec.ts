import { expect } from "vitest";

import { combineEndpointPollIntervals, pollSleepMs, resolveRtuPollInterval } from "./poll-interval.js";

/**
 * `F1.2` plan T3.2 / ADR 0016 Amendment 10 (a), ADR 0141 decision 10, ruling
 * P9 — the poll interval the host sleeps between reads.
 *
 *   interval := config.pollIntervalMs ?? organizations.default_poll_interval_ms ?? adapter default
 *
 * Assertions live here; `poll-interval.test.ts` is the vitest entry point.
 */

export function assertTheEndpointValueWins(): void {
  expect(resolveRtuPollInterval(2_000, 60_000)).toEqual({ value: 2_000, warnings: [] });
}

export function assertTheOrganizationValueIsNext(): void {
  expect(resolveRtuPollInterval(undefined, 60_000)).toEqual({ value: 60_000, warnings: [] });
  // A stored `null` is an absent value: the bind route removes the key, an old row may hold null.
  expect(resolveRtuPollInterval(null, 60_000)).toEqual({ value: 60_000, warnings: [] });
}

export function assertNeitherMeansTheAdapterDefault(): void {
  expect(resolveRtuPollInterval(undefined, null)).toEqual({ value: null, warnings: [] });
}

export function assertABadEndpointValueFallsToTheOrganizationWithOneWarning(): void {
  expect(resolveRtuPollInterval(500, 60_000)).toEqual({ value: 60_000, warnings: ["endpoint"] });
  for (const bad of [3_600_001, 1.5, "10000", -1, {}]) {
    expect(resolveRtuPollInterval(bad, 60_000), JSON.stringify(bad)).toEqual({ value: 60_000, warnings: ["endpoint"] });
  }
}

export function assertABadOrganizationValueFallsToTheAdapterWithOneWarning(): void {
  expect(resolveRtuPollInterval(undefined, 999)).toEqual({ value: null, warnings: ["organization"] });
  // Both bad: two warnings, one per level, and the adapter default.
  expect(resolveRtuPollInterval(500, 999)).toEqual({ value: null, warnings: ["endpoint", "organization"] });
  // A good endpoint value never reads the organization level, so a bad one there is not reported.
  expect(resolveRtuPollInterval(2_000, 999)).toEqual({ value: 2_000, warnings: [] });
}

export function assertAWarningNeverHoldsTheNumber(): void {
  const resolved = resolveRtuPollInterval(500, 999);
  expect(JSON.stringify(resolved.warnings)).not.toMatch(/500|999/);
}

export function assertTheShortestIntervalOnAnEndpointWins(): void {
  // P9: RTUs behind one gateway share one loop; no device is read more slowly than its own setting.
  expect(combineEndpointPollIntervals([30_000, 2_000, 10_000])).toEqual({ pollIntervalMs: 2_000, pollIntervalUsesDefault: false });
  expect(combineEndpointPollIntervals([null, null])).toEqual({ pollIntervalMs: null, pollIntervalUsesDefault: true });
  expect(combineEndpointPollIntervals([30_000, null])).toEqual({ pollIntervalMs: 30_000, pollIntervalUsesDefault: true });
  expect(combineEndpointPollIntervals([])).toEqual({ pollIntervalMs: null, pollIntervalUsesDefault: true });
}

export function assertTheSleepTakesTheAdapterDefaultOnlyWhereAnRtuUsesIt(): void {
  expect(pollSleepMs({ pollIntervalMs: null, pollIntervalUsesDefault: true }, 10_000)).toBe(10_000);
  expect(pollSleepMs({ pollIntervalMs: 2_000, pollIntervalUsesDefault: false }, 10_000)).toBe(2_000);
  expect(pollSleepMs({ pollIntervalMs: 60_000, pollIntervalUsesDefault: false }, 10_000)).toBe(60_000);
  // One RTU at 60 s and one with no setting: the one with none is read at the adapter's 10 s.
  expect(pollSleepMs({ pollIntervalMs: 60_000, pollIntervalUsesDefault: true }, 10_000)).toBe(10_000);
  expect(pollSleepMs({ pollIntervalMs: 2_000, pollIntervalUsesDefault: true }, 10_000)).toBe(2_000);
}
