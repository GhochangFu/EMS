import { expect } from "vitest";

import { parseStateValue } from "./point-key-state-value";

/**
 * `F4.309` review L4 (owner ruling Q7 (a): any finite number) — the State Labels value text to the
 * body's `value`. Decimal notation only: `Number` alone also reads hex, binary and octal literals
 * and reads blank text as `0`. `point-key-state-value.test.ts` is the Vitest entry.
 */

/** Decimal text parses: an exponent, padding, a bare fraction, a sign. */
export function parsesDecimalText(): void {
  expect(["1e3", " 2 ", ".5", "-1", "+4", "2.", "-0.25", "1E-2"].map(parseStateValue)).toEqual([
    1000, 2, 0.5, -1, 4, 2, -0.25, 0.01,
  ]);
}

/** Anything else is refused (`null`): radix literals, a comma, infinities, blank and words. */
export function refusesEverythingElse(): void {
  for (const text of ["0x1", "0b10", "0o7", "1,5", "Infinity", "-Infinity", "", "   ", "NaN", "two", "1e400", "1e", "."]) {
    expect(parseStateValue(text), text).toBeNull();
  }
}
