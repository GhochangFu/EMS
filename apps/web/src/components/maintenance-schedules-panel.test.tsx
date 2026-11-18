// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedDegradationReadLeavesThePanel,
  aRefusedConvertShowsTheSentence,
  aScheduleWithANoteShowsIt,
  aScheduleWithNoNoteShowsNone,
  deactivateMountsTheToggleStepper,
  highAndMediumPillsDiffer,
  newScheduleMountsTheCreateStepper,
  theRowFallsBackToTheLocation,
  theRowNamesTheRtu,
  theRowsWherePartWraps,
  showInactiveListsAnInactiveRowWithActivate,
  highPillIsTheRuledStrongWarning,
  mediumPillIsTheRuledSoftWarning,
} from "./maintenance-schedules-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * jsdom docblock is here because Vitest reads it from the file it collects
 * (ADR 0042 decision 2).
 */
describe("F3.65b maintenance-schedule priority colours (owner ruling R-f)", () => {
  it("renders the high and medium priority pills differently", () => {
    highAndMediumPillsDiffer();
  });

  it("gives the high pill the solid warning line on the strong wash", () => {
    highPillIsTheRuledStrongWarning();
  });

  it("gives the medium pill the soft warning line on the plain wash", () => {
    mediumPillIsTheRuledSoftWarning();
  });
});

describe("F4.204 maintenance-schedule refusals read as a sentence, not the response body", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // `F4.281`: MS1 and MS3 moved to the two stepper specs; these rows mount the steppers.
  it("MS1 + New Schedule mounts the create stepper", async () => {
    await newScheduleMountsTheCreateStepper();
  });

  it("MS2 a refused convert to work order shows the server's sentence", async () => {
    await aRefusedConvertShowsTheSentence();
  });

  it("MS3 Deactivate mounts the toggle stepper", async () => {
    await deactivateMountsTheToggleStepper();
  });

  it("F4.281: Show inactive lists a deactivated schedule with Activate", async () => {
    await showInactiveListsAnInactiveRowWithActivate();
  });

  it("F4.316: the row's asset line names the RTU", async () => {
    await theRowNamesTheRtu();
  });

  it("F4.316: an asset without an RTU is named by its location", async () => {
    await theRowFallsBackToTheLocation();
  });

  it("F4.316: the row's where part wraps instead of truncating", async () => {
    await theRowsWherePartWraps();
  });
});

describe("E1.5b a trend note beside a maintenance schedule (ADR 0138 decision 4)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a schedule whose id has a note shows it, with the Advisory pill, in that schedule's card", async () => {
    await aScheduleWithANoteShowsIt();
  });

  it("a schedule with no note shows none, even beside one of the same asset that has one", async () => {
    await aScheduleWithNoNoteShowsNone();
  });

  it("a failed degradation read leaves the panel as it is", async () => {
    await aFailedDegradationReadLeavesThePanel();
  });
});
