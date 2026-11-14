import { expect } from "vitest";

import { locationDashboardDtoSchema, locationKpiSummarySchema } from "./dashboard";
import {
  CARD_PRIMARY_METRICS,
  ENERGY_FEATURES,
  RESOLVED_CARD_PRIMARY_METRICS,
  cardPrimaryMetricSchema,
  energyFeaturesSchema,
  resolvedCardPrimaryMetricSchema,
} from "./energy-features";

/**
 * `F4.364` (ADR 0133 decisions 1, 3 and 4) — the two organization settings' vocabularies and the
 * four new keys on the location KPI row. Pure: no database. The sibling `.test.ts` carries the
 * `it()`s (ADR 0014).
 */

/** A location KPI row as the API answers it since `F4.364`. */
export const ENERGY_ROW = {
  id: "loc-1",
  name: "Cold store",
  code: "WBLDC-1",
  type: "site",
  typeLabel: "Site",
  province: null,
  organization: { id: "org-1", code: "WBLDC", name: "WBLDC" },
  rtuCount: 1,
  assetCount: 4,
  freshAssetCount: 2,
  totalKw: null,
  energyShown: false,
  primaryMetric: "health",
  healthScore: 0.75,
  openAlarms: 0,
  criticalAlarms: 0,
  scopeLabel: "full",
} as const;

/** E1 — the lists, in the order the form shows them; `auto` first and the resolved list without it. */
export function runTheListsInOrder(): void {
  expect(ENERGY_FEATURES).toEqual(["auto", "on", "off"]);
  expect(RESOLVED_CARD_PRIMARY_METRICS).toEqual(["kw", "health", "critical_alarms", "none"]);
  expect(CARD_PRIMARY_METRICS).toEqual(["auto", "kw", "health", "critical_alarms", "none"]);
  expect(energyFeaturesSchema.options).toEqual(ENERGY_FEATURES);
  expect(cardPrimaryMetricSchema.options).toEqual(CARD_PRIMARY_METRICS);
  expect(resolvedCardPrimaryMetricSchema.options).toEqual(RESOLVED_CARD_PRIMARY_METRICS);
}

/** E2 — an unknown or mis-cased value is refused by each schema; `auto` is never a resolved metric. */
export function runAnUnknownValueIsRefused(): void {
  for (const bad of ["maybe", "Auto", "", "ON"]) {
    expect(energyFeaturesSchema.safeParse(bad).success, `energy "${bad}"`).toBe(false);
    expect(cardPrimaryMetricSchema.safeParse(bad).success, `metric "${bad}"`).toBe(false);
  }
  expect(resolvedCardPrimaryMetricSchema.safeParse("auto").success).toBe(false);
  expect(cardPrimaryMetricSchema.safeParse("auto").success).toBe(true);
}

/** E3 — the row requires `energyShown`, a resolved `primaryMetric` and `healthScore`. */
export function runTheRowRequiresTheNewKeys(): void {
  expect(locationKpiSummarySchema.safeParse(ENERGY_ROW).success).toBe(true);
  for (const key of ["energyShown", "primaryMetric", "healthScore", "totalKw"] as const) {
    const { [key]: _omitted, ...without } = ENERGY_ROW;
    expect(locationKpiSummarySchema.safeParse(without).success, `without ${key}`).toBe(false);
  }
  expect(locationKpiSummarySchema.safeParse({ ...ENERGY_ROW, primaryMetric: "auto" }).success).toBe(false);
}

/** E4 — `totalKw` and `healthScore` are `number | null`: null and a number pass, undefined does not. */
export function runTheNullableFigures(): void {
  expect(locationKpiSummarySchema.safeParse({ ...ENERGY_ROW, totalKw: 12.5 }).success).toBe(true);
  expect(locationKpiSummarySchema.safeParse({ ...ENERGY_ROW, totalKw: undefined }).success).toBe(false);
  expect(locationKpiSummarySchema.safeParse({ ...ENERGY_ROW, healthScore: null }).success).toBe(true);
  expect(locationKpiSummarySchema.safeParse({ ...ENERGY_ROW, healthScore: undefined }).success).toBe(false);
}

/** E5 — the dashboard DTO is still the intersection and carries the four keys through. */
export function runTheDashboardDtoCarriesTheKeys(): void {
  const dto = {
    ...ENERGY_ROW,
    rtus: [],
    assets: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
    topAssets: [],
    workOrdersOpen: 0,
  };
  expect(locationDashboardDtoSchema._def.typeName).toBe("ZodIntersection");
  const parsed = locationDashboardDtoSchema.safeParse(dto);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.energyShown).toBe(false);
    expect(parsed.data.primaryMetric).toBe("health");
    expect(parsed.data.healthScore).toBe(0.75);
    expect(parsed.data.totalKw).toBeNull();
  }
  const { energyShown: _omitted, ...without } = dto;
  expect(locationDashboardDtoSchema.safeParse(without).success).toBe(false);
}
