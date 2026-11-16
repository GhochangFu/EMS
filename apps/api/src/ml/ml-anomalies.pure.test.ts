import { describe, it } from "vitest";

import {
  theDtosHaveExactlyTheContractsKeys,
  theSinceIsClampedToSevenDaysAndFloored,
  theWindowStartsAtFromsUtcHourAndEndsAtTo,
  truncatedIsOneRowMoreThanTheCap,
} from "./ml-anomalies.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2b — the anomaly read's pure step (ADR 0135 Amendment 5 A-e)", () => {
  it("the window starts at from's UTC hour and ends at to, unclipped", () => theWindowStartsAtFromsUtcHourAndEndsAtTo());
  it("R13: since is clamped to 7 days (older or absent), floored, and a future hour is an empty window", () =>
    theSinceIsClampedToSevenDaysAndFloored());
  it("R13: one row over 500 means truncated, and the newest 500 go out", () => truncatedIsOneRowMoreThanTheCap());
  it("the DTOs have exactly the contract's keys; the zone resolves location first", () =>
    theDtosHaveExactlyTheContractsKeys());
});
