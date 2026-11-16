import { describe, it } from "vitest";

import {
  bucketsBeforeTheCurrentHourAreDropped,
  noRowsIsNull,
  staleIsMoreThanThreeHoursAfterTheFirstBucket,
  theCurrentHourIsTheUtcHourNowIsIn,
  theListRowMapsEveryFieldAndResolvesTheZoneLocationFirst,
  thePointForecastHasExactlyTheContractsKeys,
} from "./ml-forecasts.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the forecast read's pure step (ADR 0135 Amendment 3)", () => {
  it("the current hour is the UTC hour now is in, and the look-back is 64 h", () =>
    theCurrentHourIsTheUtcHourNowIsIn());
  it("stale is a first bucket more than 3 h before the current hour", () =>
    staleIsMoreThanThreeHoursAfterTheFirstBucket());
  it("buckets before the current hour are dropped; bucket 0 is the current hour", () =>
    bucketsBeforeTheCurrentHourAreDropped());
  it("no rows, or no bucket at or after the current hour, is null", () => noRowsIsNull());
  it("the point forecast has exactly the contract's keys", () => thePointForecastHasExactlyTheContractsKeys());
  it("the list row maps every field and resolves the zone location first (C7)", () =>
    theListRowMapsEveryFieldAndResolvesTheZoneLocationFirst());
});
