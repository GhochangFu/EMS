import { describe, it } from "vitest";

import {
  anomaliesNeverChangeACandidate,
  contextCountsHoursAndSortsDetectorsAndPoints,
  contextKeepsScoresAtOrAboveTheLine,
  noEvidenceGivesNoCandidate,
  orderIsStrengthThenRecencyThenTable,
  r1ACancelledWindowNeverCounts,
  r1ACoveringWindowIsStrong,
  r1CountsAssetAndLocationTargetsOnly,
  r1SixWindowsGiveFiveNewestFirst,
  r1TimeBounds,
  r2ACommsAlarmOnTheAssetsRtuIsStrong,
  r2NeverWithoutAnRtu,
  r2TimeBoundsAndRtu,
  r3AnAssetWithoutAnRtuMatchesNoRtulessAsset,
  r3BothRelationsAreR3Only,
  r3NeverTheReRaiseNorACommsRowNorItself,
  r3SameAssetOrRtuIsModerate,
  r3TimeBounds,
  r3TitleNamesTheNewestAndCutsAt200,
  r3bLocationOnlyIsWeak,
  r4GroupsByTrimAndCaseFold,
  r4OneRowIsWeakAndTheQuoteIsNeverCut,
  r4TimeBoundsAndRule,
  r4TwoGroupsInSectionFourOrder,
  r5IsWeakUndatedAndLastAmongTheWeak,
  r5NoneWithoutACause,
  theAnomalyWindowIsTheSixWholeHoursBefore,
  theAnswerParsesAndStampsNow,
  theCapIsThree,
} from "./alarm-root-cause.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — rankRootCauseCandidates and the anomaly context step (ADR 0136)", () => {
  it("no evidence gives no candidate", () => noEvidenceGivesNoCandidate());
  it("R1: a covering window is strong and carries its start and effective end", () => r1ACoveringWindowIsStrong());
  it("R1 (R-d): asset and location targets only; a rule-only window or another org's does not count", () =>
    r1CountsAssetAndLocationTargetsOnly());
  it("R1: a window cancelled before it started (ended_at <= starts_at) never counts", () =>
    r1ACancelledWindowNeverCounts());
  it("R1: a window ending exactly 60 min before is out; one starting at T is in", () => r1TimeBounds());
  it("R1: six windows give 5 evidence items, newest first", () => r1SixWindowsGiveFiveNewestFirst());
  it("R2: an rtu_comms alarm on the asset's RTU is strong and the title names the RTU", () =>
    r2ACommsAlarmOnTheAssetsRtuIsStrong());
  it("R2: 60 min before and T are in, 60 min + 1 ms and T + 1 ms out, another RTU out", () => r2TimeBoundsAndRtu());
  it("R2: an asset with no RTU never gives R2", () => r2NeverWithoutAnRtu());
  it("R3: the same asset or the same RTU is moderate", () => r3SameAssetOrRtuIsModerate());
  it("R3b: the same location only is linked_alarm_location, weak", () => r3bLocationOnlyIsWeak());
  it("R3: an alarm with both relations is in R3 only", () => r3BothRelationsAreR3Only());
  it("R3: never a re-raise of the same rule on the asset, an rtu_comms row, or the subject itself", () =>
    r3NeverTheReRaiseNorACommsRowNorItself());
  it("R3 (R-f): 30 min and T are in, 30 min + 1 ms out", () => r3TimeBounds());
  it("R3: the title names the newest alarm; a 500-character message is cut at 200 with an ellipsis", () =>
    r3TitleNamesTheNewestAndCutsAt200());
  it("R3: an asset with no RTU is not linked to another RTU-less asset", () =>
    r3AnAssetWithoutAnRtuMatchesNoRtulessAsset());
  it("R4: trimmed, case-folded texts group; 2 is moderate, the quote is the newest trimmed text", () =>
    r4GroupsByTrimAndCaseFold());
  it("R4: one row is weak, and a long quote is never cut", () => r4OneRowIsWeakAndTheQuoteIsNeverCut());
  it("R4: two groups in section 4's order; a blank text is ignored", () => r4TwoGroupsInSectionFourOrder());
  it("R4: 180 days in, 180 days + 1 ms out, T out; no rule means no R4", () => r4TimeBoundsAndRule());
  it("R5: a class cause is weak, undated and last among the weak", () => r5IsWeakUndatedAndLastAmongTheWeak());
  it("R5: no philosophy or no cause gives none", () => r5NoneWithoutACause());
  it("order: strength, then recency, then the table's order", () => orderIsStrengthThenRecencyThenTable());
  it("cap: five candidates give the first 3", () => theCapIsThree());
  it("Q3: no anomaly input changes a candidate (strong, weak, empty evidence)", () =>
    anomaliesNeverChangeACandidate());
  it("context: 0.989999 gives none; exactly 0.99 gives one", () => contextKeepsScoresAtOrAboveTheLine());
  it("context: distinct hours, sorted detectors, distinct sorted points (at most 5), the window only", () =>
    contextCountsHoursAndSortsDetectorsAndPoints());
  it("R-g: the anomaly window is the six whole UTC hours before the alarm's hour", () =>
    theAnomalyWindowIsTheSixWholeHoursBefore());
  it("the whole answer parses under the contract and stamps computedAt", () => theAnswerParsesAndStampsNow());
});
