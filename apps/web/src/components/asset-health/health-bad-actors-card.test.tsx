// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aPendingReadSaysLoading,
  aRejectedReadIsAMutedSentence,
  aRowsLinkIsItsHref,
  aWeakRowSaysWeakSignal,
  anUnsafeHrefIsPlainText,
  anomalyNullAndNoLowestDrawsNothing,
  anomalyNullShowsOnlyTheLowestContent,
  eachRowHasTheInfoPillAndTheHeaderNone,
  fiveRowsInTheApisOrder,
  noBandOrAlarmColourClass,
  noItemsSaysNoUnusualHours,
  showCountDrawsTheCountLine,
  theCaveatAndTheCaption,
  theLowestTabIsNotAdvisory,
  theReadCarriesTheCardsScope,
  theTabsMoveWithArrowKeys,
  theScoreLineOnlyWithBothScores,
  theTitleAndTheDefaultTab,
} from "./health-bad-actors-card.spec";

/**
 * `E1.8c` T3.1 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014), and the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2).
 */
describe("E1.8c the Bad actors — advisory card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the title and opens on the Anomaly history tab", async () => {
    await theTitleAndTheDefaultTab();
  });

  it("lists the rows in the API's order with their hour counts, site and points", async () => {
    await fiveRowsInTheApisOrder();
  });

  it("links a row to its href", async () => {
    await aRowsLinkIsItsHref();
  });

  it("renders an unsafe href as plain text", async () => {
    await anUnsafeHrefIsPlainText();
  });

  it("says Weak signal on a weak row only", async () => {
    await aWeakRowSaysWeakSignal();
  });

  it("shows the score line only when both scores exist", async () => {
    await theScoreLineOnlyWithBothScores();
  });

  it("shows the API's caveat and the caption with the info pill", async () => {
    await theCaveatAndTheCaption();
  });

  it("puts the info pill on each anomaly row and none in the header", async () => {
    await eachRowHasTheInfoPillAndTheHeaderNone();
  });

  it("keeps the Lowest health score tab free of any Advisory label", async () => {
    await theLowestTabIsNotAdvisory();
  });

  it("uses no band, alarm or severity colour class on either tab", async () => {
    await noBandOrAlarmColourClass();
  });

  it("says Loading… while the read is pending", async () => {
    await aPendingReadSaysLoading();
  });

  it("shows a muted sentence for a rejected read", async () => {
    await aRejectedReadIsAMutedSentence();
  });

  it("shows only the Lowest content with no tab strip when anomaly is null", async () => {
    await anomalyNullShowsOnlyTheLowestContent();
  });

  it("draws nothing when anomaly is null and there is no lowest row", async () => {
    await anomalyNullAndNoLowestDrawsNothing();
  });

  it("says No unusual hours when the anomaly half has no item", async () => {
    await noItemsSaysNoUnusualHours();
  });

  it("draws the count line with showCount only", async () => {
    await showCountDrawsTheCountLine();
  });

  it("sends the card's own scope with the read", async () => {
    await theReadCarriesTheCardsScope();
  });

  it("moves between tabs with the arrow keys, Home and End", async () => {
    await theTabsMoveWithArrowKeys();
  });
});
