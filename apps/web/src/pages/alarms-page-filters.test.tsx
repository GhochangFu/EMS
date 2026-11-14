// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFilteredEmptyListSaysSo,
  anOrganizationRefetchesAndIsInTheUrl,
  aSeverityFiltersTheListAndTheCards,
  aSixKeyUrlIsTheFirstRead,
  backUndoesAStateChoice,
  theListWaitsForTheOptions,
  theStateDropdownSendsTheState,
} from "./alarms-page-filters.spec";

/** `F4.361` U7 — the Alarm Centre filters. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 alarm centre filters", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("reads again with a chosen organization and writes it into the URL", () => anOrganizationRefetchesAndIsInTheUrl());
  it("sends the State dropdown's state", () => theStateDropdownSendsTheState());
  it("filters the list and the cards by severity, and Critical drops all clear", () => aSeverityFiltersTheListAndTheCards());
  it("sends a six-key URL unchanged on the first read", () => aSixKeyUrlIsTheFirstRead());
  it("waits for the options before a scoped first read", () => theListWaitsForTheOptions());
  it("says a filtered empty list matches nothing", () => aFilteredEmptyListSaysSo());
  it("undoes a State choice with Back", () => backUndoesAStateChoice());
});
