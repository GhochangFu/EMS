// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aClickCallsOnUseOnceAndNoFetch,
  aFailedReadShowsTheFailedSentence,
  aFailedRefetchKeepsTheCandidates,
  aWindowFocusDoesNotRefetch,
  noContextNoLine,
  showsTheEmptySentence,
  showsThePillAndTheDisclaimer,
  showsTheStrengthWordsAndNoPercentage,
  theClassCauseHasNoButton,
  theContextLineLinksToTheHistoryWindow,
  twinEvidenceItemsGetDistinctKeys,
  usesNoAlarmOrSeverityColour,
  withoutOnUseThereIsNoButton,
} from "./alarm-root-cause-section.spec";

/**
 * `E2.3` (ADR 0136 decision 6) — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest collects (ADR 0042).
 */
describe("E2.3 — the Possible causes section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the Advisory pill and the disclaimer", () => showsThePillAndTheDisclaimer());
  it("shows the strength words and no percentage", () => showsTheStrengthWordsAndNoPercentage());
  it("shows the empty sentence", () => showsTheEmptySentence());
  it("a failed read shows the failed sentence, not an alert", () => aFailedReadShowsTheFailedSentence());
  it("uses no alarm or severity colour", () => usesNoAlarmOrSeverityColour());
  it("without onUse there is no button", () => withoutOnUseThereIsNoButton());
  it("the class cause has no button; R1–R4 each have one", () => theClassCauseHasNoButton());
  it("a click calls onUse once and makes no request", () => aClickCallsOnUseOnceAndNoFetch());
  it("the context line links to the asset history window", () => theContextLineLinksToTheHistoryWindow());
  it("no context item, no context line", () => noContextNoLine());
  it("a failed refetch keeps the loaded candidates", () => aFailedRefetchKeepsTheCandidates());
  it("a window focus does not read the suggestions again", () => aWindowFocusDoesNotRefetch());
  it("twin evidence items get distinct keys", () => twinEvidenceItemsGetDistinctKeys());
});
