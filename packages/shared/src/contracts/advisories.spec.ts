import { expect } from "vitest";

import {
  ADVISORY_ANOMALY_CONTEXT_MAX,
  ADVISORY_DEFAULT_PF_THRESHOLD,
  ADVISORY_DISCLAIMER,
  ADVISORY_EMPTY_SENTENCE,
  ADVISORY_MAX_ASSETS,
  ADVISORY_MIN_COVERAGE,
  ADVISORY_PROJECTION_DAYS,
  ADVISORY_TARGET_PF,
  ADVISORY_WINDOW_DAYS,
  advisoriesResponseSchema,
  advisorySchema,
} from "./advisories";

/**
 * `E1.6a` / ADR 0137 — the advisories response contract (plan §4.5, T1.1).
 * Assertions live here; `advisories.test.ts` is the vitest entry point
 * (ADR 0014). Fixtures use made-up names only.
 */
const ASSET = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION = "33333333-3333-4333-8333-333333333333";

const advisory = {
  id: `${ASSET}:low_power_factor`,
  kind: "low_power_factor",
  confidence: "measured",
  organizationId: ORGANIZATION,
  locationId: LOCATION,
  assetId: ASSET,
  assetCode: "EM-01",
  assetName: "Fixture meter 1",
  assetRtuName: null,
  assetLocationName: "North Yard",
  timeZone: "Asia/Kolkata",
  windowFrom: "2026-11-09T18:30:00.000Z",
  windowTo: "2026-11-16T18:30:00.000Z",
  headline: "Power factor averaged 0.87 over the last 7 days, below 0.95.",
  lines: ["About 1,212 kVAh could be avoided at a power factor of 0.99."],
  context: [],
  assumptions: ["Target power factor: 0.99 (fixed)."],
  currency: "INR",
  money: { window: 10182, projected: 43637 },
  kwh: null,
  kvah: { window: 1212, projected: 5195 },
  co2Kg: null,
  kvar: 21,
  powerFactor: 0.87,
};

const response = {
  asOf: "2026-11-17T06:00:00.000Z",
  candidates: 3,
  considered: 2,
  advisories: [advisory],
};

/** A full response parses. */
export function aFullResponseParses(): void {
  expect(advisoriesResponseSchema.safeParse(response).success).toBe(true);
}

/** A kind outside the three is refused (`load_shift` is not built). */
export function anUnknownKindIsRefused(): void {
  expect(advisorySchema.safeParse({ ...advisory, kind: "load_shift" }).success).toBe(false);
}

/** A confidence outside the three is refused (no `high`). */
export function anUnknownConfidenceIsRefused(): void {
  expect(advisorySchema.safeParse({ ...advisory, confidence: "high" }).success).toBe(false);
}

/** Every advisory names at least one assumption. */
export function emptyAssumptionsAreRefused(): void {
  expect(advisorySchema.safeParse({ ...advisory, assumptions: [] }).success).toBe(false);
}

/** At most 6 lines. */
export function sevenLinesAreRefused(): void {
  const lines = Array.from({ length: 7 }, (_, i) => `Line ${i}.`);
  expect(advisorySchema.safeParse({ ...advisory, lines }).success).toBe(false);
  expect(advisorySchema.safeParse({ ...advisory, lines: lines.slice(0, 6) }).success).toBe(true);
}

/** A response is not strict: an older bundle parses a newer API's key. */
export function anExtraKeyParses(): void {
  expect(advisorySchema.safeParse({ ...advisory, later: 1 }).success).toBe(true);
  expect(advisoriesResponseSchema.safeParse({ ...response, later: true }).success).toBe(true);
}

/** No money is `null`, never `0`. */
export function nullMoneyParses(): void {
  expect(advisorySchema.safeParse({ ...advisory, money: null, kvar: null, powerFactor: null }).success).toBe(true);
}

/** The constants are the ADR's numbers. */
export function theConstantsAreTheAdrsNumbers(): void {
  expect(ADVISORY_WINDOW_DAYS).toBe(7);
  expect(ADVISORY_PROJECTION_DAYS).toBe(30);
  expect(ADVISORY_MAX_ASSETS).toBe(200);
  expect(ADVISORY_DEFAULT_PF_THRESHOLD).toBe(0.95);
  expect(ADVISORY_TARGET_PF).toBe(0.99);
  expect(ADVISORY_MIN_COVERAGE).toBe(0.8);
  expect(ADVISORY_ANOMALY_CONTEXT_MAX).toBe(25);
}

/** The two fixed sentences are the ADR's text. */
export function theFixedSentencesAreTheAdrsText(): void {
  expect(ADVISORY_DISCLAIMER).toBe("An estimate from the last 7 days, not a guaranteed saving.");
  expect(ADVISORY_EMPTY_SENTENCE).toBe(
    "No advisories. An energy meter gets advisories when it has real data, a tariff or rate, and 7 complete days.",
  );
}
