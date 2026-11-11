// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusalIsShownInPercentAndBlocksSave,
  aSavedRemovalShowsTheEmptyState,
  aServerRefusalIsShownVerbatim,
  aWeightEditIsWrittenAndOnesAreNot,
  anEmptyDraftStaysEmptyUntilThePresetIsClicked,
  anUndeclaredWeightIsShownAndFlagged,
  anUntouchedStoredBlockIsClean,
  bandsMoveAndRemove,
  readOnlyShowsTheBandsWithNoWritePath,
  removeAsksFirstAndSavesWithoutHealth,
} from "./health-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F4.355 health tab — ADR 0038 Amendment 7, ADR 0050 Amendment 4", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a published version read-only, with no write path", () => {
    readOnlyShowsTheBandsWithNoWritePath();
  });

  it("keeps an empty draft empty until the preset is clicked, then saves the five bands", async () => {
    await anEmptyDraftStaysEmptyUntilThePresetIsClicked();
  });

  it("writes an edited weight and omits weights of 1", async () => {
    await aWeightEditIsWrittenAndOnesAreNot();
  });

  it("shows a refusal in percent and blocks Save", async () => {
    await aRefusalIsShownInPercentAndBlocksSave();
  });

  it("moves and removes bands", async () => {
    await bandsMoveAndRemove();
  });

  it("asks before Remove health bands and saves without a health key", async () => {
    await removeAsksFirstAndSavesWithoutHealth();
  });

  it("shows and flags a weight on a key that is no point", () => {
    anUndeclaredWeightIsShownAndFlagged();
  });

  it("shows the server's refusal verbatim", async () => {
    await aServerRefusalIsShownVerbatim();
  });

  it("treats an untouched stored block as clean", () => {
    anUntouchedStoredBlockIsClean();
  });

  it("shows the empty state after a saved removal, not the old bands", async () => {
    await aSavedRemovalShowsTheEmptyState();
  });
});
