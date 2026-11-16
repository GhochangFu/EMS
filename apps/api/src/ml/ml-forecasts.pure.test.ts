import { describe, it } from "vitest";

import {
  aWindowWithNoPastHourIsNull,
  bucketsBeforeTheCurrentHourAreDropped,
  noRowsIsNull,
  staleIsMoreThanThreeHoursAfterTheFirstBucket,
  theCurrentHourIsTheUtcHourNowIsIn,
  theListRowMapsEveryFieldAndResolvesTheZoneLocationFirst,
  thePastRowsMapToTheContractsBuckets,
  thePastWindowIsFlooredAndClippedToTheCurrentHour,
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
  it("E1.4e: the past window starts at from's UTC hour and ends at to or the current hour, whichever is earlier", () =>
    thePastWindowIsFlooredAndClippedToTheCurrentHour());
  it("E1.4e: a window with no past hour is null, so nothing is read", () => aWindowWithNoPastHourIsNull());
  it("E1.4e: past rows map to the contract's { t, p50 } buckets", () => thePastRowsMapToTheContractsBuckets());
});
