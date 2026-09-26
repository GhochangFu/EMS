import { locationKpiSummarySchema } from "./dashboard";

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
