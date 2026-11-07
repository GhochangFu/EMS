import { describe, it } from "vitest";

import {
  aTabsProblemsAreNamedNeverCut,
  theAppendBodyCarriesTheKindTheRangeAndThePoints,
  theDraftRowIsInsertedAtTheFootOfItsTab,
  thePairsFollowTheSelectionThenTheStrip,
  theStripsHiddenAssetsAreCounted,
} from "./trend-strip-wizard-chart.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.324 PR 2 — the trend strip wizard's Draw as Chart (ADR 0108 Amendment 9 item 3)", () => {
  it("binds the chosen points' assets in selection order", () => thePairsFollowTheSelectionThenTheStrip());
  it("names a tab's problem and never cuts", () => aTabsProblemsAreNamedNeverCut());
  it("counts the assets the strip read hid", () => theStripsHiddenAssetsAreCounted());
  it("builds the append body with the kind, the range's window and the points", () =>
    theAppendBodyCarriesTheKindTheRangeAndThePoints());
  it("inserts the draft row at the foot of its tab", () => theDraftRowIsInsertedAtTheFootOfItsTab());
});
