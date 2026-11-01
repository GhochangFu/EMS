import { expect } from "vitest";

import {
  TREND_POINTS_PER_SEGMENT_MAX,
  putOrgTrendPointsBodySchema,
  trendPointSegmentSchema,
} from "./trend-points";

/**
 * `F4.300` / ADR 0108 decision 3 — the organization trend-point override
 * contract (plan U1). One claim per helper; the `.test.ts` wrapper gives each
 * its own `it()`.
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const point = { code: "kw", name: "Power", unit: "kW", active: true };
const segment = (source: string): unknown => ({
  domain: "electrical",
  label: "Electrical",
  source,
  points: [point],
  catalogDefaults: [point],
  updatedAt: null,
  updatedBy: null,
});

const codes = (n: number): string[] => Array.from({ length: n }, (_, i) => `code_${i}`);

/** P1 — the cap is 12 and a list of 12 parses. */
export function acceptsTheCapAndRefusesOneMore(): void {
  expect(TREND_POINTS_PER_SEGMENT_MAX).toBe(12);
  expect(putOrgTrendPointsBodySchema.safeParse({ pointKeys: codes(12) }).success).toBe(true);
  expect(putOrgTrendPointsBodySchema.safeParse({ pointKeys: codes(13) }).success).toBe(false);
}

/** P2 — a duplicate code is refused. */
export function refusesADuplicate(): void {
  expect(putOrgTrendPointsBodySchema.safeParse({ pointKeys: ["kw", "kw"] }).success).toBe(false);
}

/** P3 — a code outside the catalog class is refused. */
export function refusesABadCode(): void {
  expect(putOrgTrendPointsBodySchema.safeParse({ pointKeys: ["bad code!"] }).success).toBe(false);
}

/** P4 — `.strict()`: an unknown key is refused. */
export function refusesAnUnknownKey(): void {
  const parsed = putOrgTrendPointsBodySchema.safeParse({ pointKeys: [], organizationId: UUID });
  expect(parsed.success).toBe(false);
  expect(parsed.error?.issues[0]?.code).toBe("unrecognized_keys");
}

/** P5 — an empty list is accepted: that is "back to the catalog default". */
export function acceptsAnEmptyList(): void {
  expect(putOrgTrendPointsBodySchema.parse({ pointKeys: [] })).toEqual({ pointKeys: [] });
}

/** P6 — both sources parse, a third is refused. */
export function parsesTwoSourcesOnly(): void {
  expect(trendPointSegmentSchema.safeParse(segment("catalog")).success).toBe(true);
  expect(trendPointSegmentSchema.safeParse(segment("organization")).success).toBe(true);
  expect(trendPointSegmentSchema.safeParse(segment("site")).success).toBe(false);
}
