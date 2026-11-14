import { describe, it } from "vitest";

import {
  assertTheCostReadInjectsTheResolver,
  assertTheMetricCatalogBuildsTheResolver,
  assertTheModulesProvideTheResolver,
  INJECTED_SITES,
} from "./energy-rate-resolver-wiring.spec";

/** `F4.365` U7 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — the cost reads take EnergyRateResolver", () => {
  for (const site of INJECTED_SITES) {
    it(`${site.className} injects EnergyRateResolver`, () => assertTheCostReadInjectsTheResolver(site));
  }
  it("MetricCatalogService builds the resolver in its constructor", () => assertTheMetricCatalogBuildsTheResolver());
  it("TariffRatesModule provides it to DashboardModule and ReportsCoreModule", () => assertTheModulesProvideTheResolver());
});
