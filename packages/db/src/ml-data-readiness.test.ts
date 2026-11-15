import { describe, it } from "vitest";

import {
  assertBatteryIsOnlyReportedWhereABatterySignalExists,
  assertEmptyReportSaysSo,
  assertLongWellCoveredRealHistoryIsReady,
  assertLowCoverageHoldsAnomalyAtPartial,
  assertMissingBatteryFamiliesAreNamed,
  assertReportListsRealBeforeSimulated,
  assertRulNeedsClosedWorkOrders,
  assertShortHistoryIsPartialForForecastingAndNotReadyForAnomaly,
  assertSimulatedDataIsNeverReady,
} from "./ml-data-readiness.spec";

describe("ML data readiness (ADR 0135 decision 8)", () => {
  it("never calls simulator data ready", assertSimulatedDataIsNeverReady);
  it("calls long, well-covered real history ready", assertLongWellCoveredRealHistoryIsReady);
  it("short history: forecasting partial, anomaly not ready", assertShortHistoryIsPartialForForecastingAndNotReadyForAnomaly);
  it("low coverage holds anomaly at partial", assertLowCoverageHoldsAnomalyAtPartial);
  it("reports battery only where a battery signal exists", assertBatteryIsOnlyReportedWhereABatterySignalExists);
  it("names missing battery signal families", assertMissingBatteryFamiliesAreNamed);
  it("RUL needs closed work orders", assertRulNeedsClosedWorkOrders);
  it("lists real classes before simulated ones", assertReportListsRealBeforeSimulated);
  it("says so when there is no telemetry", assertEmptyReportSaysSo);
});
