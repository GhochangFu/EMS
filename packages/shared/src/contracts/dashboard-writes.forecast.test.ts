import { describe, it } from "vitest";

import {
  acceptsAForecastWithOnePoint,
  refusesAForecastConfigKey,
  refusesAForecastWithoutExactlyOnePoint,
} from "./dashboard-writes.forecast.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4c — the forecast widget write arm (ADR 0135 Amendment 3 C1)", () => {
  it("has a write arm, last, and accepts a forecast with one point", () => {
    acceptsAForecastWithOnePoint();
  });

  it("refuses no point, two points, and a source", () => {
    refusesAForecastWithoutExactlyOnePoint();
  });

  it("refuses any config key", () => {
    refusesAForecastConfigKey();
  });
});
