import { describe, it } from "vitest";

import {
  eachConfidenceHasItsLabel,
  eachKindHasItsLabel,
  theRefetchIsFifteenMinutes,
  theShownOfSentenceOnlyWhenCapped,
} from "./advisories.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6b — advisories helpers", () => {
  it("each kind has its label", () => eachKindHasItsLabel());
  it("each confidence has its label", () => eachConfidenceHasItsLabel());
  it("the page reads again every 15 minutes", () => theRefetchIsFifteenMinutes());
  it("says how many meters were shown only when capped", () => theShownOfSentenceOnlyWhenCapped());
});
