// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  everyStringIsRenderedAsSent,
  noAssetLinkWhenHidden,
  noContextDrawsNoContextList,
  theAssetLinksToItsHistory,
  theAssumptionsAreClosed,
  thePillIsInfoAndNoAlarmColour,
} from "./advisory-card.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.6b — the advisory card", () => {
  it("renders every string exactly as sent", () => everyStringIsRenderedAsSent());
  it("links the asset to its history page by its label", () => theAssetLinksToItsHistory());
  it("shows an Advisory pill in the info tone and no alarm colour", () => thePillIsInfoAndNoAlarmColour());
  it("draws no asset link when showAsset is false", () => noAssetLinkWhenHidden());
  it("keeps the assumptions in a closed details", () => theAssumptionsAreClosed());
  it("draws no context list when there is none", () => noContextDrawsNoContextList());
});
