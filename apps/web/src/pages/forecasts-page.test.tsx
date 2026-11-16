// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aFailedReadShowsTheError,
  aPendingReadIsLoadingNotEmpty,
  anEmptyListSaysWhy,
  anUnknownZoneFallsBackToUtc,
  eachRowsTimesAreInItsOwnZone,
  freshAndStalePills,
  rowsRenderInTheGivenOrder,
  theLinkOpensTheHistoryWithThePoint,
  theListIsReadEveryFifteenMinutes,
  thePageSaysAdvisory,
  theRangeCarriesTheUnit,
} from "./forecasts-page.spec";

/**
 * Vitest entry point (ADR 0014, ADR 0042 decision 2) — assertions live in the sibling `.spec`.
 * `TZ` is pinned to a zone no fixture uses, so a time formatted in the browser's zone fails.
 */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.4b — the Forecasts page", () => {
  it("renders rows in the given order", () => rowsRenderInTheGivenOrder());
  it("formats each row's times in its own site zone", () => eachRowsTimesAreInItsOwnZone());
  it("falls back to UTC for a zone this browser does not know", () => anUnknownZoneFallsBackToUtc());
  it("reads the range as min – max with the unit, and the model by its label", () => theRangeCarriesTheUnit());
  it("shows Fresh and Stale pills", () => freshAndStalePills());
  it("links each row to the asset's history with that point", () => theLinkOpensTheHistoryWithThePoint());
  it("says why an empty list is empty (C8)", () => anEmptyListSaysWhy());
  it("says advisory", () => thePageSaysAdvisory());
  it("shows the error text when the read fails", () => aFailedReadShowsTheError());
  it("says loading, not empty, while the read is pending", () => aPendingReadIsLoadingNotEmpty());
  it("reads the list again every 15 minutes", () => theListIsReadEveryFifteenMinutes());
});
