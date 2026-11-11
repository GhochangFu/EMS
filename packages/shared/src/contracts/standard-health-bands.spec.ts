import { expect } from "vitest";

import {
  MAX_HEALTH_BANDS,
  MAX_HEALTH_WEIGHT,
  STANDARD_HEALTH_BANDS,
  templateHealthSchema,
} from "./asset-template-content-writes";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * The five standard bands (ADR 0038 Amendment 7 B3, ADR 0050 Amendment 4).
 *
 * Written out here rather than derived from the export, so this file is a second
 * statement of the values and not an echo of them.
 */
export function assertTheStandardBandsAreTheFiveLiteralRows(): void {
  expect(STANDARD_HEALTH_BANDS).toEqual([
    { code: "excellent", label: "Excellent", minScore: 0.95 },
    { code: "good", label: "Good", minScore: 0.85 },
    { code: "fair", label: "Fair", minScore: 0.7 },
    { code: "poor", label: "Poor", minScore: 0.5 },
    { code: "critical", label: "Critical", minScore: 0 },
  ]);
}

/** The preset must be a band list the write path accepts, or the button saves a refusal. */
export function assertTheStandardBandsParseWithTheSchema(): void {
  const parsed = templateHealthSchema.safeParse({
    bands: STANDARD_HEALTH_BANDS.map((band) => ({ ...band })),
  });
  expect(parsed.success).toBe(true);
}

/** The two caps the browser form reads are exported with their current values. */
export function assertTheHealthCapsAreExported(): void {
  expect(MAX_HEALTH_BANDS).toBe(10);
  expect(MAX_HEALTH_WEIGHT).toBe(1000);
}
