import { describe, it } from "vitest";

import {
  anAnomalyIsOfferedOnEveryScopeAndNoTemplate,
  anAnomalyRoundTripsWithItsPointAndAnEmptyConfig,
  aNewAnomalyIsHalfWidthAndAsksForItsPoint,
} from "./dashboard-builder-anomaly.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2d — the anomaly widget in the dashboard builder", () => {
  it("round-trips an anomaly row with its point and config {}", () => {
    anAnomalyRoundTripsWithItsPointAndAnEmptyConfig();
  });

  it("adds a 6x4 anomaly widget that asks for its point", () => {
    aNewAnomalyIsHalfWidthAndAsksForItsPoint();
  });

  it("is offered on every scope kind and to no template", () => {
    anAnomalyIsOfferedOnEveryScopeAndNoTemplate();
  });
});
