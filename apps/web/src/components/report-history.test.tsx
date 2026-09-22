// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  a503RendersTheApiSentence,
  aRefusedDownloadRendersTheApiSentence,
  aScheduledFileRendersScheduledAndPending,
  anEmptyListRendersTheEmptySentence,
  anotherErrorRendersTheGenericSentence,
  deleteCallsTheApiOnceAndRefetchesTheList,
  downloadCallsTheApiWithTheDto,
  releasingOneDeleteFreesOnlyThatRowsButton,
  theLoadingSentenceRendersWhileTheListIsOpen,
  twoDeletesInFlightKeepBothButtonsPending,
  twoFilesRenderTwoRowsWithSizePeriodAndDelivery,
} from "./report-history.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.5a report history list", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the loading sentence while the list is open", async () => {
    await theLoadingSentenceRendersWhileTheListIsOpen();
  });

  it("renders two rows with size, period, format and delivery", async () => {
    await twoFilesRenderTwoRowsWithSizePeriodAndDelivery();
  });

  it("a scheduled file renders Scheduled and Pending beside an on-demand row (F3.5b item 7 D)", async () => {
    await aScheduledFileRendersScheduledAndPending();
  });

  it("Download calls downloadReportFile with the row's DTO", async () => {
    await downloadCallsTheApiWithTheDto();
  });

  it("a refused download renders the API's sentence", async () => {
    await aRefusedDownloadRendersTheApiSentence();
  });

  it("Delete calls deleteReportFile once with the row's id and refetches the list", async () => {
    await deleteCallsTheApiOnceAndRefetchesTheList();
  });

  it("two deletes in flight keep both buttons on Deleting…", async () => {
    await twoDeletesInFlightKeepBothButtonsPending();
  });

  it("releasing one delete frees only that row's button", async () => {
    await releasingOneDeleteFreesOnlyThatRowsButton();
  });

  it("an ApiError 503 renders the API's sentence", async () => {
    await a503RendersTheApiSentence();
  });

  it("another error renders the generic sentence", async () => {
    await anotherErrorRendersTheGenericSentence();
  });

  it("an empty list renders the empty sentence", async () => {
    await anEmptyListRendersTheEmptySentence();
  });
});
