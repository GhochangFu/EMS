import { dashboardKpisSchema, locationKpiSummarySchema, mapSiteDtoSchema } from "./dashboard";

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
  typeLabel: "SMOC campus",
  province: "Western Cape",
  organization: { id: "org-1", code: "ESKOM", name: "Eskom" },
  rtuCount: 1,
  assetCount: 4,
  freshAssetCount: 2,
  totalKw: 12.5,
  energyShown: true,
  primaryMetric: "kw",
  healthScore: null,
  openAlarms: 0,
  criticalAlarms: 0,
  scopeLabel: "full",
  parentId: null,
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

/**
 * `F4.157` U8 (OQ4) — the location KPI row gains `typeLabel`, the joined
 * `bms.location_types.label`. The mutation is `.optional()` on the field.
 */
export function runLocationKpiSummaryRequiresTypeLabelTest(): void {
  const { typeLabel: _typeLabel, ...withoutTypeLabel } = { ...ROW_WITHOUT_CODE, code: "RSMOC-WC" };
  const refused = locationKpiSummarySchema.safeParse(withoutTypeLabel);
  assert(refused.success === false, "a location KPI row without typeLabel — expected a refusal, got success");

  const accepted = locationKpiSummarySchema.safeParse({ ...ROW_WITHOUT_CODE, code: "RSMOC-WC" });
  assert(
    accepted.success === true,
    `the same row with typeLabel — expected success, got a refusal: ${
      accepted.success ? "" : JSON.stringify(accepted.error.issues)
    }`,
  );
}

/**
 * `F4.240` (ADR 0139 decision 12) — the location KPI row names its parent: a
 * string, or `null` for a root and for a parent the caller cannot read. The
 * key is required, so a producer that forgets it is refused rather than read
 * as a root.
 */
export function runLocationKpiSummaryRequiresParentIdTest(): void {
  const row = { ...ROW_WITHOUT_CODE, code: "RSMOC-WC" };
  const asRoot = locationKpiSummarySchema.safeParse({ ...row, parentId: null });
  assert(
    asRoot.success === true,
    `a row with parentId: null — expected success, got a refusal: ${
      asRoot.success ? "" : JSON.stringify(asRoot.error.issues)
    }`,
  );
  const asChild = locationKpiSummarySchema.safeParse({ ...row, parentId: "loc-parent" });
  assert(
    asChild.success === true && asChild.data.parentId === "loc-parent",
    `a row with parentId: "loc-parent" — expected success carrying it, got ${JSON.stringify(asChild)}`,
  );
  const { parentId: _parentId, ...withoutParentId } = { ...row, parentId: null };
  const refused = locationKpiSummarySchema.safeParse(withoutParentId);
  assert(refused.success === false, "a location KPI row without parentId — expected a refusal, got success");
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

/** A full `GET /dashboard/kpis` payload with energy shown (`F4.375`, plan U2). */
const KPIS = {
  totalKw: 42,
  energyShown: true,
  sitesOnline: 1,
  sitesTotal: 2,
  alarmsOpen: 0,
  alarmsCritical: 0,
  pueEstimate: null,
  asOf: "2026-11-15T00:00:00.000Z",
  prior: { asOf: "2026-11-14T00:00:00.000Z", totalKw: null, alarmsOpen: 0, pueEstimate: null },
};

/**
 * `F4.375` (ADR 0133 Amendment 2, plan D1) — the estate KPI payload carries a required
 * `energyShown` and a nullable `totalKw`: a payload without `energyShown` or with a non-boolean
 * one fails; `totalKw: null` passes and `undefined` fails; the full payload parses.
 */
export function runDashboardKpisEnergyShownTest(): void {
  assert(dashboardKpisSchema.safeParse(KPIS).success, "the full KPI payload — expected success");
  const { energyShown: _omitted, ...withoutFlag } = KPIS;
  assert(!dashboardKpisSchema.safeParse(withoutFlag).success, "a KPI payload without energyShown — expected a refusal");
  assert(
    !dashboardKpisSchema.safeParse({ ...KPIS, energyShown: "yes" }).success,
    "energyShown: \"yes\" — expected a refusal",
  );
  assert(
    dashboardKpisSchema.safeParse({ ...KPIS, energyShown: false, totalKw: null }).success,
    "totalKw: null — expected success",
  );
  assert(
    !dashboardKpisSchema.safeParse({ ...KPIS, totalKw: undefined }).success,
    "totalKw: undefined — expected a refusal",
  );
}
