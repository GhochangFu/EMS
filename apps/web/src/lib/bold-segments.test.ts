import { describe, it } from "vitest";

import {
  aPairedMarkerMakesTheMiddleBold,
  aTrailingUnpairedMarkerStaysLiteralAfterAPair,
  anUnpairedMarkerStaysLiteral,
  emptySegmentsAreDropped,
  htmlStaysPlainText,
} from "./bold-segments.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.198 boldSegments", () => {
  it("makes a paired marker's content bold", () => {
    aPairedMarkerMakesTheMiddleBold();
  });

  it("leaves a lone marker as literal text", () => {
    anUnpairedMarkerStaysLiteral();
  });

  it("keeps a trailing unpaired marker literal after a pair", () => {
    aTrailingUnpairedMarkerStaysLiteralAfterAPair();
  });

  it("never interprets HTML", () => {
    htmlStaysPlainText();
  });

  it("drops empty segments", () => {
    emptySegmentsAreDropped();
  });
});
