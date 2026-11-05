import { expect } from "vitest";

import { POINT_KEY_STATE_SEED } from "@bms/db";

import { isSeededPointKeyState } from "./point-key-states.pure";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 3 (owner ruling Q3 (a)) — a row is seeded when its
 * `(point_key_code, value)` is a pair of `POINT_KEY_STATE_SEED`. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

/** The seven seeded pairs, as the seed file states them (ADR 0088 Amendment 3, Context). */
const SEVEN = [
  ["breaker_main", 0],
  ["breaker_main", 1],
  ["breaker_trip", 1],
  ["valve_open", 1],
  ["valve_open", 0],
  ["damper_open", 1],
  ["damper_open", 0],
] as const;

/** The `@bms/db` export is the seven rows; a seed change reddens this before it moves the gate. */
export function theExportIsTheSevenSeededRows(): void {
  expect(POINT_KEY_STATE_SEED.map((row) => [row.pointKeyCode, row.value])).toEqual(SEVEN);
}

/** Every seeded pair answers true. */
export function theSevenPairsAreSeeded(): void {
  for (const [pointKey, value] of SEVEN) expect(isSeededPointKeyState(pointKey, value), `${pointKey}=${value}`).toBe(true);
}

/** A seeded key with another value, an unseeded key with a seeded value, and a near-miss code are not. */
export function threeNonPairsAreNotSeeded(): void {
  expect(isSeededPointKeyState("breaker_trip", 0)).toBe(false);
  expect(isSeededPointKeyState("breaker_aux", 1)).toBe(false);
  expect(isSeededPointKeyState("Breaker_main", 1)).toBe(false);
}
