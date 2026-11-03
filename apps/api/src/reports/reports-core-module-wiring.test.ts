import { describe, it } from "vitest";

import * as spec from "./reports-core-module-wiring.spec";

/** `F4.303` U13 — `ReportsCoreModule` wiring for the `trend_points` render. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 — ReportsCoreModule wiring (ADR 0108 Amendment 6 item 8)", () => {
  it("provides TrendPointsReportService and TelemetryService", spec.assertTheModuleProvidesTheTrendServiceAndTelemetry);
  it("imports no TelemetryModule", spec.assertTheModuleImportsNoTelemetryModule);
  it("TelemetryService's @Inject tokens resolve inside the module", spec.assertTelemetryServiceTokensResolve);
  it("TelemetryService has no class-typed parameter", spec.assertTelemetryServiceHasNoClassTypedParameter);
  it("TrendPointsReportService's dependencies resolve inside the module", spec.assertTrendServiceDepsResolve);
  it("positive control — ReportRenderService takes TrendPointsReportService last", spec.assertTheRenderServiceTakesTheTrendServiceLast);
  it("ReportRenderService's dependencies resolve inside the module", spec.assertTheRenderServiceDepsResolve);
});
