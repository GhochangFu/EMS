// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aClickFillsTheRootCauseAndSendsNothing,
  aDeviceAlarmGetsNoSection,
  aFailedReadLeavesThePanelWorking,
  aFillOnStepThreeShowsTheStatusLine,
  aViewerSeesTheSectionAndNoButton,
  cancelAfterAFillAsks,
  savedTextAsksBeforeReplacing,
  submitSendsTheFilledRootCauseOnly,
  theFilledTextStaysEditable,
  theSameTextAgainAsksNothing,
  theSectionSitsBetweenTheClassBlockAndTheForm,
  typedTextAsksBeforeReplacing,
} from "./alarm-details-panel.root-cause.spec";

/**
 * `E2.3` (ADR 0136 decision 6) — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest collects (ADR 0042).
 */
describe("E2.3 — Use as root cause on the Alarm Details panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the section sits between the class philosophy and the form", () => theSectionSitsBetweenTheClassBlockAndTheForm());
  it("a click fills the root cause and sends nothing", () => aClickFillsTheRootCauseAndSendsNothing());
  it("Submit sends the filled root cause and every other field as it was", () => submitSendsTheFilledRootCauseOnly());
  it("the filled text stays editable", () => theFilledTextStaysEditable());
  it("saved text asks before it is replaced; Keep and Replace", () => savedTextAsksBeforeReplacing());
  it("typed text asks before it is replaced, and Replace never appends", () => typedTextAsksBeforeReplacing());
  it("the same text again asks nothing", () => theSameTextAgainAsksNothing());
  it("a viewer sees the section and no button", () => aViewerSeesTheSectionAndNoButton());
  it("a device alarm gets no section and no read", () => aDeviceAlarmGetsNoSection());
  it("a failed suggestions read leaves the panel working", () => aFailedReadLeavesThePanelWorking());
  it("Cancel after a fill asks before leaving", () => cancelAfterAFillAsks());
  it("a fill on step 3 shows the status line and does not jump", () => aFillOnStepThreeShowsTheStatusLine());
});
