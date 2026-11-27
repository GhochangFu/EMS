import { expect } from "vitest";

import {
  DEGRADATION_CARD_MAX,
  DEGRADATION_CARD_TITLE,
  DEGRADATION_DISCLAIMER,
  DEGRADATION_DRIFT_TARGETS,
  DEGRADATION_ESTIMATED_LABEL,
  DEGRADATION_HEALTH_LIMIT_BAND,
  DEGRADATION_MAX_ASSETS,
  DEGRADATION_MAX_HORIZON_DAYS,
  DEGRADATION_MIN_DAYS,
  DEGRADATION_MIN_HORIZON_DAYS,
  DEGRADATION_NAME,
  DEGRADATION_P_VALUE,
  DEGRADATION_RECENT_DAYS,
  DEGRADATION_SECTION_TITLE,
  DEGRADATION_WINDOW_DAYS,
  degradationResponseSchema,
} from "./degradation";

/**
 * `E1.5a` / ADR 0138 — the degradation response contract (plan §4.10, T1.1).
 * Assertions live here; `degradation.test.ts` is the vitest entry point
 * (ADR 0014). Fixtures use made-up names only.
 */
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const SCHEDULE_ID = "44444444-4444-4444-8444-444444444444";

const indicator = () => ({
  id: `${ASSET_ID}:health`,
  kind: "health" as const,
  status: "crossing" as const,
  pointKey: null as string | null,
  unit: null as string | null,
  current: 72.5,
  limit: 60,
  limitSource: { kind: "band" as const, name: "Fair" },
  slopePerWeek: -1.5,
  daysToLimit: { min: 14, max: 40 as number | null } as { min: number; max: number | null } | null,
  daysWithData: 25,
  summary: "Health trending down: reaches 60% in about 14 to 40 days",
  sentence: "At the trend of the last 28 days, health reaches 60% in about 14 to 40 days.",
  detail: "Now 72.5%. Limit 60%. Change: -1.5% a week.",
  assumptions: ["Window: 2026-10-20 to 2026-11-16 (28 local days, today not included), Asia/Kolkata."],
});

const response = () => ({
  asOf: "2026-11-18T06:00:00.000Z",
  candidates: 3,
  considered: 2,
  assets: [
    {
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      locationId: LOCATION_ID,
      assetCode: "FX-H1",
      assetName: "Fixture chiller",
      assetRtuName: null as string | null,
      assetLocationName: "North Yard",
      timeZone: "Asia/Kolkata",
      windowFrom: "2026-10-20",
      windowTo: "2026-11-16",
      indicators: [indicator()],
      scheduleNotes: [
        {
          scheduleId: SCHEDULE_ID,
          nextDueAt: "2026-12-01T00:00:00.000Z",
          sentence: "Trend reaches its limit in about 14 to 40 days; next service due in 13 days.",
        },
      ],
    },
  ],
});

export function aFullResponseParses(): void {
  expect(degradationResponseSchema.safeParse(response()).success).toBe(true);
}

export function anUnknownKindIsRefused(): void {
  const value = response();
  (value.assets[0]!.indicators[0] as { kind: string }).kind = "rul";
  expect(degradationResponseSchema.safeParse(value).success).toBe(false);
}

export function anUnknownStatusIsRefused(): void {
  const value = response();
  (value.assets[0]!.indicators[0] as { status: string }).status = "failed";
  expect(degradationResponseSchema.safeParse(value).success).toBe(false);
}

export function daysToLimitMinOfZeroIsRefused(): void {
  const value = response();
  value.assets[0]!.indicators[0]!.daysToLimit = { min: 0, max: 5 };
  expect(degradationResponseSchema.safeParse(value).success).toBe(false);
}

export function daysToLimitMaxNullParses(): void {
  const value = response();
  value.assets[0]!.indicators[0]!.daysToLimit = { min: 3, max: null };
  expect(degradationResponseSchema.safeParse(value).success).toBe(true);
}

export function twentyDaysWithDataIsRefused(): void {
  const value = response();
  value.assets[0]!.indicators[0]!.daysWithData = 20;
  expect(degradationResponseSchema.safeParse(value).success).toBe(false);
  value.assets[0]!.indicators[0]!.daysWithData = 21;
  expect(degradationResponseSchema.safeParse(value).success).toBe(true);
}

export function emptyIndicatorsAndAssumptionsAreRefused(): void {
  const noIndicators = response();
  noIndicators.assets[0]!.indicators = [];
  expect(degradationResponseSchema.safeParse(noIndicators).success).toBe(false);
  const noAssumptions = response();
  noAssumptions.assets[0]!.indicators[0]!.assumptions = [];
  expect(degradationResponseSchema.safeParse(noAssumptions).success).toBe(false);
}

export function anExtraKeyParses(): void {
  const value = { ...response(), futureKey: 1 };
  expect(degradationResponseSchema.safeParse(value).success).toBe(true);
}

export function theConstantsAreTheAdrsNumbers(): void {
  expect(DEGRADATION_WINDOW_DAYS).toBe(28);
  expect(DEGRADATION_MIN_DAYS).toBe(21);
  expect(DEGRADATION_RECENT_DAYS).toBe(3);
  expect(DEGRADATION_P_VALUE).toBe(0.05);
  expect(DEGRADATION_MIN_HORIZON_DAYS).toBe(1);
  expect(DEGRADATION_MAX_HORIZON_DAYS).toBe(90);
  expect(DEGRADATION_MAX_ASSETS).toBe(200);
  expect(DEGRADATION_CARD_MAX).toBe(10);
  expect(DEGRADATION_HEALTH_LIMIT_BAND).toBe("fair");
}

export function theFixedStringsAreTheAdrsText(): void {
  expect(DEGRADATION_NAME).toBe("Time to limit (trend)");
  expect(DEGRADATION_SECTION_TITLE).toBe("Degradation — advisory");
  expect(DEGRADATION_CARD_TITLE).toBe("Trending toward a limit — advisory");
  expect(DEGRADATION_ESTIMATED_LABEL).toBe("Estimated");
  expect(DEGRADATION_DISCLAIMER).toBe("A trend from the last 28 days, not a failure prediction.");
}

export function theDriftTargetsAreTwentyTwoWithoutKwhTotal(): void {
  expect(DEGRADATION_DRIFT_TARGETS).toHaveLength(22);
  expect(DEGRADATION_DRIFT_TARGETS.some((t) => (t.pointKey as string) === "kwh_total")).toBe(false);
  const keys = DEGRADATION_DRIFT_TARGETS.map((t) => `${t.domain}/${t.assetType}/${t.pointKey}`);
  expect(new Set(keys).size).toBe(22);
}
