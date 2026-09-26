import { locationKpiSummarySchema, mapSiteDtoSchema } from "./dashboard";

/**
 * `F3.70` (ADR 0076 decision 9, D7) — `code` on the location KPI row, so the
 * `/cr-*` redirect can find `RSMOC-WC` by its readable code instead of a name
 * string. Assertions live here; `dashboard.test.ts` is the Vitest entry point
 * (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ROW_WITHOUT_CODE = {
  id: "loc-1",
  name: "Western Cape Campus",
  type: "smoc_campus",
  province: "Western Cape",
  organization: { id: "org-1", code: "ESKOM", name: "Eskom" },
  rtuCount: 1,
  assetCount: 4,
  freshAssetCount: 2,
  totalKw: 12.5,
  openAlarms: 0,
  criticalAlarms: 0,
  scopeLabel: "full",
};

/** K1 — a row without `code` is refused. */
export function runRowWithoutCodeIsRefusedTest(): void {
  const result = locationKpiSummarySchema.safeParse(ROW_WITHOUT_CODE);
  assert(result.success === false, "a location KPI row without code — expected a refusal, got success");
}

/** K2 — the same row with `code: "RSMOC-WC"` parses. */
export function runRowWithCodeParsesTest(): void {
  const result = locationKpiSummarySchema.safeParse({ ...ROW_WITHOUT_CODE, code: "RSMOC-WC" });
  assert(
    result.success === true,
    `a location KPI row with code: "RSMOC-WC" — expected success, got a refusal: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`,
  );
}

const MAP_SITE_WITHOUT_KIND_LABEL = {
  id: "site-1",
  canonicalLocationId: null,
  slug: "lotapata",
  name: "Lotapata",
  kind: "pump_station",
  siteName: "Lotapata",
  organization: null,
  latitude: 24.1,
  longitude: 88.4,
  capacityMw: null,
  stationType: null,
  stationCategory: null,
  province: null,
  stationOperatingStatus: null,
  live: {
    status: "unknown",
    openAlarms: 0,
    criticalAlarms: 0,
    assetsTotal: 0,
    assetsFresh: 0,
  },
};

/**
 * `F4.157` (ADR 0077 D8) — the map DTO gains `kindLabel`, the joined
 * `bms.location_types.label` (or the API's own label for a map-only kind like
 * `eskom_station`). C3's mutation is `.optional()` on the field.
 */
export function runMapSiteDtoRequiresKindLabelTest(): void {
  const withoutLabel = mapSiteDtoSchema.safeParse(MAP_SITE_WITHOUT_KIND_LABEL);
  assert(withoutLabel.success === false, "a map site without kindLabel — expected a refusal, got success");

  const withLabel = mapSiteDtoSchema.safeParse({
    ...MAP_SITE_WITHOUT_KIND_LABEL,
    kindLabel: "Pump station",
  });
  assert(
    withLabel.success === true,
    `the same site with kindLabel: "Pump station" — expected success, got a refusal: ${
      withLabel.success ? "" : JSON.stringify(withLabel.error.issues)
    }`,
  );
}
