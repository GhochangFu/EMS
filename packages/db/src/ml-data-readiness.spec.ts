import { expect } from "vitest";

import { assessRow, missingBatteryFamilies, type ReadinessRow, renderReport } from "./ml-data-readiness";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

function row(over: Partial<ReadinessRow> = {}): ReadinessRow {
  return {
    domain: "water",
    assetType: "pump",
    source: "real",
    assets: 4,
    points: 20,
    daysWithData: 60,
    meanHourlyCoverage: 0.95,
    firstBucket: "2026-09-01",
    lastBucket: "2026-10-30",
    pointKeys: ["flow_m3h", "kw"],
    closedWorkOrders: 0,
    ...over,
  };
}

const verdictOf = (r: ReadinessRow, useCase: string) => assessRow(r).find((x) => x.useCase === useCase)?.verdict;

export function assertSimulatedDataIsNeverReady(): void {
  const r = row({ source: "simulated", daysWithData: 400, closedWorkOrders: 50 });
  expect(assessRow(r).every((x) => x.verdict === "not_ready")).toBe(true);
}

export function assertLongWellCoveredRealHistoryIsReady(): void {
  const r = row();
  expect(verdictOf(r, "forecasting")).toBe("ready");
  expect(verdictOf(r, "anomaly")).toBe("ready");
}

export function assertShortHistoryIsPartialForForecastingAndNotReadyForAnomaly(): void {
  const r = row({ daysWithData: 20 });
  expect(verdictOf(r, "forecasting")).toBe("partial");
  expect(verdictOf(r, "anomaly")).toBe("not_ready");
}

export function assertLowCoverageHoldsAnomalyAtPartial(): void {
  expect(verdictOf(row({ meanHourlyCoverage: 0.5 }), "anomaly")).toBe("partial");
}

export function assertBatteryIsOnlyReportedWhereABatterySignalExists(): void {
  expect(verdictOf(row(), "battery_health")).toBeUndefined();
  expect(verdictOf(row({ pointKeys: ["battery_v"] }), "battery_health")).toBe("not_ready");
  expect(
    verdictOf(row({ pointKeys: ["battery_v", "battery_temp_c", "battery_current_a"] }), "battery_health"),
  ).toBe("ready");
}

export function assertMissingBatteryFamiliesAreNamed(): void {
  expect(missingBatteryFamilies(["batt_volt"])).toEqual(["temperature", "current or charge"]);
}

export function assertRulNeedsClosedWorkOrders(): void {
  expect(verdictOf(row({ closedWorkOrders: 3 }), "rul")).toBe("not_ready");
  expect(verdictOf(row({ closedWorkOrders: 12 }), "rul")).toBe("partial");
}

export function assertReportListsRealBeforeSimulated(): void {
  const text = renderReport([row({ source: "simulated", domain: "aaa" }), row()], "T");
  expect(text.indexOf("[REAL]")).toBeLessThan(text.indexOf("[SIMULATED]"));
  expect(text).toContain("1 asset class(es) with real data, 1 with simulator data only.");
}

export function assertEmptyReportSaysSo(): void {
  expect(renderReport([], "T")).toContain("No telemetry");
}
