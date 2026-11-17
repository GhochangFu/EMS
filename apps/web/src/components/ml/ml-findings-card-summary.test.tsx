// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  s10ARemountStartsFolded,
  s11ANoneSummaryHidesTheBoxAndTheHeading,
  s12NoAlarmColourInTheBox,
  s1ThreeSentencesAreAHeadlineAndTwoPoints,
  s2OneSentenceIsTheHeadlineAlone,
  s3SixSentencesShowFourPoints,
  s4ChipsShowTheCodeWithTheLabelAsTitle,
  s5TheFactsFoldToTwoLinesUnderTheBox,
  s6TwoFactsShowWithNoButton,
  s7NoBoxShowsEveryLine,
  s8CompactShowsTheHeadlineAndTwoPoints,
  s9EachCardOpensOnItsOwn,
} from "./ml-findings-card-summary.spec";

/** `E1.9g` — the AI summary box, chips and computed facts. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9g MlFindingsCard AI summary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("S1 three sentences: the headline, two points, the label with the mark, the note, the info tint", () =>
    s1ThreeSentencesAreAHeadlineAndTwoPoints());
  it("S2 one sentence is the headline alone", () => s2OneSentenceIsTheHeadlineAlone());
  it("S3 six sentences show four points", () => s3SixSentencesShowFourPoints());
  it("S4 a chip shows the code, its title the full label, its link unchanged", () => s4ChipsShowTheCodeWithTheLabelAsTitle());
  it("S5 under the box the facts fold to two lines behind Show 2 more", () => s5TheFactsFoldToTwoLinesUnderTheBox());
  it("S6 two facts show both lines and no button", () => s6TwoFactsShowWithNoButton());
  it("S7 with no box every line shows, with no heading and no button", () => s7NoBoxShowsEveryLine());
  it("S8 compact shows the headline, two points and the compact note", () => s8CompactShowsTheHeadlineAndTwoPoints());
  it("S9 opening one card leaves another folded", () => s9EachCardOpensOnItsOwn());
  it("S10 a remount starts folded", () => s10ARemountStartsFolded());
  it("S11 a summary with only the none line hides the box and the heading", () => s11ANoneSummaryHidesTheBoxAndTheHeading());
  it("S12 no alarm or severity colour in the box, full and compact", () => s12NoAlarmColourInTheBox());
});
