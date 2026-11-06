import { describe, it } from "vitest";

import {
  aCostTileUsesTheResolvesCurrency,
  aCriticalCountIsTheNoteAndTheTone,
  aMissingValueIsADashWithAReason,
  aReadPastTheBoundIsStale,
  aRollUpShowsItsCoverageOnlyWhenPartial,
  aTileWithNoSourceIsADash,
  onlyTheAlarmTileTakesTheAlarmTone,
  openWithNoCriticalIsAWarning,
  sitesLiveReadsLiveOverTotal,
  sitesLiveZeroReadsZeroOverZero,
  thePriorBecomesTheDelta,
  thePrimaryIsTheLowestSortOrder,
} from "./organization-strip.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.317 organization strip tile rules", () => {
  it("S1 takes the primary from the lowest sortOrder", thePrimaryIsTheLowestSortOrder);
  it("S2 turns the prior into the delta only for a tile that asks", thePriorBecomesTheDelta);
  it("S3 reads a critical count as the note and the tone", aCriticalCountIsTheNoteAndTheTone);
  it("S4 warns on open alarms with none critical", openWithNoCriticalIsAWarning);
  it("S5 gives only the alarm tile the alarm tone", onlyTheAlarmTileTakesTheAlarmTone);
  it("S6 reads sites live as live / total", sitesLiveReadsLiveOverTotal);
  it("S7 reads zero of zero as 0 / 0", sitesLiveZeroReadsZeroOverZero);
  it("S8 marks a read past the bound stale", aReadPastTheBoundIsStale);
  it("S9 draws a missing value as a dash with a reason", aMissingValueIsADashWithAReason);
  it("S10 draws a tile with no source as a dash", aTileWithNoSourceIsADash);
  it("S12 notes partial coverage on a roll-up", aRollUpShowsItsCoverageOnlyWhenPartial);
  it("S11 draws a cost in the resolve's currency", aCostTileUsesTheResolvesCurrency);
});
