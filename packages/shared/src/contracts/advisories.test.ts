import { describe, it } from "vitest";

import {
  aFullResponseParses,
  anExtraKeyParses,
  anUnknownConfidenceIsRefused,
  anUnknownKindIsRefused,
  emptyAssumptionsAreRefused,
  nullMoneyParses,
  sevenLinesAreRefused,
  theConstantsAreTheAdrsNumbers,
  theFixedSentencesAreTheAdrsText,
} from "./advisories.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — the advisories contract (ADR 0137)", () => {
  it("a full response parses", () => aFullResponseParses());
  it("kind `load_shift` is refused", () => anUnknownKindIsRefused());
  it("confidence `high` is refused", () => anUnknownConfidenceIsRefused());
  it("an empty assumptions list is refused", () => emptyAssumptionsAreRefused());
  it("7 lines are refused; 6 parse", () => sevenLinesAreRefused());
  it("an extra key parses (responses are not strict)", () => anExtraKeyParses());
  it("`money: null` parses", () => nullMoneyParses());
  it("the constants are 7, 30, 200, 0.95, 0.99, 0.8, 25", () => theConstantsAreTheAdrsNumbers());
  it("the disclaimer and the empty sentence are the ADR's text", () => theFixedSentencesAreTheAdrsText());
});
