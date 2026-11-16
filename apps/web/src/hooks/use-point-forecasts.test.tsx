// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aCachedForecastIsHiddenOnceDisabled,
  aFailedReadIsNoForecast,
  aFailedRefetchDropsTheLastForecast,
  aForbiddenReadIsNotPolledAgain,
  disabledAsksNothing,
  onePointReadPerChartedPoint,
} from "./use-point-forecasts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.4a — usePointForecasts", () => {
  it("one read per charted point, each query carrying the 15-minute re-poll", () => onePointReadPerChartedPoint());
  it("disabled asks nothing", () => disabledAsksNothing());
  it("a cached forecast is hidden once the gate turns off", () => aCachedForecastIsHiddenOnceDisabled());
  it("a failed first read, settled, is no forecast", () => aFailedReadIsNoForecast());
  it("a failed refetch drops the last forecast", () => aFailedRefetchDropsTheLastForecast());
  it("a forbidden read is not polled again", () => aForbiddenReadIsNotPolledAgain());
});
