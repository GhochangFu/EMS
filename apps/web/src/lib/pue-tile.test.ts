import { describe, it } from "vitest";

import {
  aMeasuredRatioRendersToTwoDecimals,
  anUnconfiguredEstateIsEmptyWithAReason,
  aPendingOrFailedQueryPassesItsStatusThrough,
  theNotConfiguredHintCarriesTheEmDash,
} from "./pue-tile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.8 pue tile props", () => {
  it("renders a measured ratio to two decimals", () => {
    aMeasuredRatioRendersToTwoDecimals();
  });

  it("renders an unconfigured estate as an empty tile with a reason", () => {
    anUnconfiguredEstateIsEmptyWithAReason();
  });

  it("passes a loading or failed query's status through", () => {
    aPendingOrFailedQueryPassesItsStatusThrough();
  });

  it("uses the em dash in the not-configured hint", () => {
    theNotConfiguredHintCarriesTheEmDash();
  });
});
