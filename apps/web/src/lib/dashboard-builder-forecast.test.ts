import { describe, it } from "vitest";

import {
  aForecastIsOfferedOnEveryScopeAndNoTemplate,
  aForecastRoundTripsWithItsPointAndAnEmptyConfig,
  aNewForecastIsHalfWidthAndAsksForItsPoint,
} from "./dashboard-builder-forecast.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4c — the forecast widget in the dashboard builder", () => {
  it("round-trips a forecast row with its point and config {}", () => {
    aForecastRoundTripsWithItsPointAndAnEmptyConfig();
  });

  it("adds a 6x4 forecast that asks for its point", () => {
    aNewForecastIsHalfWidthAndAsksForItsPoint();
  });

  it("is offered on every scope kind and to no template", () => {
    aForecastIsOfferedOnEveryScopeAndNoTemplate();
  });
});
