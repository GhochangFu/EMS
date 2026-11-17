// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedReadIsOneMutedSentence,
  aPendingReadSaysLoading,
  assetReferencesLinkOnlyToSafeHrefs,
  disabledMakesNoRequest,
  eachFactLineReadsItsText,
  noAlarmColourInTheSection,
  noCardsDrawsNothing,
  twoCardsInTheApisOrder,
  twoKindsNameTheirKind,
  twoKindsPendingNamesTheKind,
} from "./ml-findings-card.spec";

/** `E1.9b` — the findings card. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9b MlFindingsCard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("draws two cards in the API's order with the heading and the pill", () => twoCardsInTheApisOrder());
  it("reads each fact line with its assets put back", () => eachFactLineReadsItsText());
  it("links a named asset only to a safe href, and draws no listed-only asset", () =>
    assetReferencesLinkOnlyToSafeHrefs());
  it("uses no alarm or severity colour", () => noAlarmColourInTheSection());
  it("says loading while the read is pending", () => aPendingReadSaysLoading());
  it("says one muted sentence when the read fails", () => aFailedReadIsOneMutedSentence());
  it("makes no request when disabled", () => disabledMakesNoRequest());
  it("draws nothing when there are no cards", () => noCardsDrawsNothing());
  it("names the kind on each card and in a failed line when two kinds show", () => twoKindsNameTheirKind());
  it("names the kind in a pending line when two kinds show", () => twoKindsPendingNamesTheKind());
});
