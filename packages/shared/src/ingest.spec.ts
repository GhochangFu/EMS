import { expect } from "vitest";

import { mqttTopicHasWildcard } from "./ingest";

/**
 * `F4.221` — `mqttTopicHasWildcard`, the one predicate ingest, onboarding and the admin RTU
 * routes read.
 *
 * Assertions live here; `ingest.test.ts` is the vitest entry point (ADR 0014). One claim per
 * exported function, so a mutation reddens the `it` that owns it.
 */

/** A lone `#` is the multi-level wildcard. */
export function aLoneHashIsAWildcard(): void {
  expect(mqttTopicHasWildcard("#")).toBe(true);
}

/** A lone `+` is the single-level wildcard. */
export function aLonePlusIsAWildcard(): void {
  expect(mqttTopicHasWildcard("+")).toBe(true);
}

/** A trailing `#` after real levels is still a wildcard. */
export function aTrailingHashIsAWildcard(): void {
  expect(mqttTopicHasWildcard("a/b/#")).toBe(true);
}

/** A `+` in the middle of real levels is still a wildcard. */
export function aMiddlePlusIsAWildcard(): void {
  expect(mqttTopicHasWildcard("a/+/c")).toBe(true);
}

/** The pilot's real topic shape names one device. */
export function anOrdinaryTopicIsNotAWildcard(): void {
  expect(mqttTopicHasWildcard("Airsprint-1051/Data/1051")).toBe(false);
}

/** An empty topic holds no wildcard — the update schema's clear path depends on it. */
export function anEmptyTopicIsNotAWildcard(): void {
  expect(mqttTopicHasWildcard("")).toBe(false);
}
