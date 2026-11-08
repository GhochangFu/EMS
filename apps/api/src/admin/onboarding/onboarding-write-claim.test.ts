import { describe, it } from "vitest";

import {
  assertEveryCodeWrittenLineIsAClaim,
  assertNegationsOffersAndReadsAreNotClaims,
  assertProseWriteClaimsAreClaims,
  assertTheReplacementKeepsNonClaimsAndLeadsWithTheFixedLine,
  assertTheRetryNamesTheToolAndIsNullWhenTheTurnWrote,
} from "./onboarding-write-claim.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the onboarding write-claim guard (F4.339, ADR 0117 decision 2)", () => {
  it("tags every code-written action-line shape as a claim", () => {
    assertEveryCodeWrittenLineIsAClaim();
  });

  it("tags prose that says the draft changed", () => {
    assertProseWriteClaimsAreClaims();
  });

  it("does not tag negations, refusals, offers or read answers", () => {
    assertNegationsOffersAndReadsAreNotClaims();
  });

  it("names the hinted tool in the retry, and sends none when the turn wrote", () => {
    assertTheRetryNamesTheToolAndIsNullWhenTheTurnWrote();
  });

  it("drops claims and leads with the fixed line", () => {
    assertTheReplacementKeepsNonClaimsAndLeadsWithTheFixedLine();
  });
});
