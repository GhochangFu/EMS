import { expect } from "vitest";

import { kwText } from "./location-card-figure";

/**
 * `F4.364` (ADR 0133 decision 4, plan U6) — the kW figure text now that the summary's `totalKw`
 * is `number | null`. The sibling `.test.ts` carries the `it()`s (ADR 0014).
 */

/** F1 — `null` is an em dash, never `0.0`; a number keeps one decimal, `0` included. */
export function runKwText(): void {
  expect(kwText(null)).toBe("—");
  expect(kwText(0)).toBe("0.0");
  expect(kwText(12.34)).toBe("12.3");
}
