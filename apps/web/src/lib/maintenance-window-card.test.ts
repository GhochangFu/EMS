import { describe, it } from "vitest";

import { anotherEntryGetsNoRows, onlyValidValuesAreReplaced, theRecordsTimeIsTheNow } from "./maintenance-window-card.spec";

/** `F4.362` leftover 1 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.362 — a maintenance-window card's shown rows", () => {
  it("another entry gets no rows", anotherEntryGetsNoRows);
  it("only valid values are replaced", onlyValidValuesAreReplaced);
  it("the record's time is the Now", theRecordsTimeIsTheNow);
});
