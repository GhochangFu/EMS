// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFourHundredIsTheRefusalSentence,
  aNewAttemptClearsTheSentence,
  aSecondClickWhilePendingStartsNothing,
  anyOtherStatusIsExportFailed,
  eachButtonAsksForItsFormat,
  theButtonsAreBusyWhilePending,
  theErrorMessageIsNeverRendered,
  theGroupHoldsCsvAndXlsx,
} from "./export-menu.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.303 ExportMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("M1: a group labelled Export holds CSV and XLSX", () => {
    theGroupHoldsCsvAndXlsx();
  });
  it("M1: each button asks for its own format", async () => {
    await eachButtonAsksForItsFormat();
  });
  it("M2: both buttons are aria-busy while pending and clear after", async () => {
    await theButtonsAreBusyWhilePending();
  });
  it("M2: a second click while pending starts nothing", async () => {
    await aSecondClickWhilePendingStartsNothing();
  });
  it("M3: a 400 is the refusal sentence", async () => {
    await aFourHundredIsTheRefusalSentence();
  });
  it("M3: any other status is Export failed.", async () => {
    await anyOtherStatusIsExportFailed();
  });
  it("M3: the error message is never rendered", async () => {
    await theErrorMessageIsNeverRendered();
  });
  it("M3: a new attempt clears the previous sentence", async () => {
    await aNewAttemptClearsTheSentence();
  });
});
