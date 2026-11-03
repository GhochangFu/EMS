import { expect } from "vitest";

import { copilotCreateReportScheduleModelBodySchema, createReportScheduleBodySchema, updateReportScheduleBodySchema } from "./report-writes";
import { reportScheduleDtoSchema, reportTemplateIdSchema } from "./reports";
import {
  energyReportParamsSchema,
  reportScheduleParamsSchema,
  trendPointsReportParamsSchema,
} from "./trend-points-report";

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 items 6 and 8) — the report template enum, the schedule
 * params (two strict arms) and the create / update / DTO shapes that carry them. One claim per
 * exported function; `trend-points-report.test.ts` wraps each in its own `it()`.
 */

const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

const PAIR = { assetId: ASSET_A, pointKey: "kw" };
const PAIRS = [PAIR, { assetId: ASSET_B, pointKey: "pf" }];

const NINE_PAIRS = Array.from({ length: 9 }, (_, i) => ({ assetId: ASSET_A, pointKey: `p${i}` }));

const CREATE_BASE = {
  name: "Weekly",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "08:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
};

const DTO_BASE = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  name: "Weekly",
  templateId: "energy_consumption",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "08:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
  channelId: null,
  enabled: true,
  nextRunAt: "2026-11-09T02:30:00.000Z",
  lastRunAt: null,
  createdBy: null,
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
};

/** R1 */
export function templateIdIsExactlyTheTwoValues(): void {
  expect(reportTemplateIdSchema.options).toEqual(["energy_consumption", "trend_points"]);
}

/** R2 */
export function energyParamsAdmitsCompareFalse(): void {
  expect(energyReportParamsSchema.safeParse({ compare: false }).success).toBe(true);
}
export function energyParamsRefusesAStringCompare(): void {
  expect(energyReportParamsSchema.safeParse({ compare: "yes" }).success).toBe(false);
}
export function energyParamsRefusesAnEmptyObject(): void {
  expect(energyReportParamsSchema.safeParse({}).success).toBe(false);
}
export function energyParamsRefusesAnUnknownKey(): void {
  expect(energyReportParamsSchema.safeParse({ compare: true, note: "x" }).success).toBe(false);
}

/** R3 */
export function trendParamsAdmitsOnePairWithCompare(): void {
  expect(trendPointsReportParamsSchema.safeParse({ points: [PAIR], compare: true }).success).toBe(true);
}
export function trendParamsRefusesNoPoints(): void {
  expect(trendPointsReportParamsSchema.safeParse({ points: [], compare: true }).success).toBe(false);
}
export function trendParamsRefusesNinePoints(): void {
  expect(trendPointsReportParamsSchema.safeParse({ points: NINE_PAIRS, compare: true }).success).toBe(false);
}
export function trendParamsRefusesANonUuidAsset(): void {
  expect(
    trendPointsReportParamsSchema.safeParse({ points: [{ assetId: "nope", pointKey: "kw" }], compare: true }).success,
  ).toBe(false);
}
export function trendParamsRefusesABadPointKey(): void {
  expect(
    trendPointsReportParamsSchema.safeParse({ points: [{ assetId: ASSET_A, pointKey: "bad code" }], compare: true })
      .success,
  ).toBe(false);
}
export function trendParamsRefusesAnItemWithAnExtraKey(): void {
  expect(
    trendPointsReportParamsSchema.safeParse({ points: [{ ...PAIR, label: "x" }], compare: true }).success,
  ).toBe(false);
}
export function trendParamsRefusesAMissingCompare(): void {
  expect(trendPointsReportParamsSchema.safeParse({ points: [PAIR] }).success).toBe(false);
}

/** R4 */
export function unionParsesCompareAloneAsTheEnergyArm(): void {
  const parsed = reportScheduleParamsSchema.parse({ compare: true });
  expect("points" in parsed).toBe(false);
}
export function unionParsesPointsAsTheTrendArm(): void {
  const parsed = reportScheduleParamsSchema.parse({ points: PAIRS, compare: false });
  expect("points" in parsed).toBe(true);
}
export function unionParsesCompareWithPointsAsTheTrendArmOnly(): void {
  expect(energyReportParamsSchema.safeParse({ compare: true, points: PAIRS }).success).toBe(false);
  expect(trendPointsReportParamsSchema.safeParse({ compare: true, points: PAIRS }).success).toBe(true);
}

/** R5 */
export function createBodyDefaultsTheTemplateToEnergy(): void {
  const parsed = createReportScheduleBodySchema.parse(CREATE_BASE);
  expect(parsed.templateId).toBe("energy_consumption");
  expect(parsed.params).toBeUndefined();
}
export function createBodyAdmitsATrendPointsTemplateWithParams(): void {
  const parsed = createReportScheduleBodySchema.parse({
    ...CREATE_BASE,
    templateId: "trend_points",
    params: { points: PAIRS, compare: true },
  });
  expect(parsed.templateId).toBe("trend_points");
}
export function createBodyRefusesAnUnknownTemplate(): void {
  expect(createReportScheduleBodySchema.safeParse({ ...CREATE_BASE, templateId: "pdf" }).success).toBe(false);
}
export function createBodyRefusesABadParamsArm(): void {
  expect(createReportScheduleBodySchema.safeParse({ ...CREATE_BASE, params: { compare: "x" } }).success).toBe(false);
}

/** R6 */
export function updateBodyRefusesTheTemplateId(): void {
  expect(updateReportScheduleBodySchema.safeParse({ name: "x", templateId: "trend_points" }).success).toBe(false);
}
export function updateBodyRefusesParams(): void {
  expect(updateReportScheduleBodySchema.safeParse({ name: "x", params: { compare: true } }).success).toBe(false);
}

/** R7 */
export function dtoAdmitsNullParams(): void {
  expect(reportScheduleDtoSchema.safeParse({ ...DTO_BASE, params: null }).success).toBe(true);
}
export function dtoAdmitsTheEnergyArm(): void {
  expect(reportScheduleDtoSchema.safeParse({ ...DTO_BASE, params: { compare: true } }).success).toBe(true);
}
export function dtoAdmitsTheTrendArm(): void {
  expect(
    reportScheduleDtoSchema.safeParse({
      ...DTO_BASE,
      templateId: "trend_points",
      params: { points: PAIRS, compare: false },
    }).success,
  ).toBe(true);
}
export function dtoRefusesArrayParams(): void {
  expect(reportScheduleDtoSchema.safeParse({ ...DTO_BASE, params: [] }).success).toBe(false);
}

/** R8 (pinned, unchanged) */
export function copilotModelBodyRefusesTheTemplateId(): void {
  const body = { ...CREATE_BASE, organizationId: DTO_BASE.organizationId };
  expect(copilotCreateReportScheduleModelBodySchema.safeParse(body).success).toBe(true);
  expect(copilotCreateReportScheduleModelBodySchema.safeParse({ ...body, templateId: "trend_points" }).success).toBe(
    false,
  );
}
