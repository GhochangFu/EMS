import { describe, it } from "vitest";

import {
  aNewMlFindingsRowSavesBothKeysAndNoBinding,
  anEmptyStoredConfigReadsAsTheDefaults,
  anMlFindingsIsOfferedOnEveryScopeAndNoTemplate,
  aStoredMlFindingsConfigRoundTrips,
} from "./dashboard-builder-ml-findings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9f — the ml_findings widget in the dashboard builder", () => {
  it("adds a 6x4 widget that saves { show: both, paragraph: true }, no point, no source", () => {
    aNewMlFindingsRowSavesBothKeysAndNoBinding();
  });

  it("round-trips a stored { show: anomalies, paragraph: false }", () => {
    aStoredMlFindingsConfigRoundTrips();
  });

  it("reads a stored {} as the defaults", () => {
    anEmptyStoredConfigReadsAsTheDefaults();
  });

  it("is offered on every scope kind and to no template", () => {
    anMlFindingsIsOfferedOnEveryScopeAndNoTemplate();
  });
});
