import { describe, it } from "vitest";

import {
  allClearOnlyUnfilteredBySeverityOrSuppressed,
  filteredMeansAnyKey,
  readsStateAndSeverity,
  theQueryJoinsScopeAndPage,
  writeKeepsTheScope,
} from "./alarm-page-filter.spec";

/** `F4.361` U7 — the Alarm Centre's Severity and State filters. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 alarm page filter", () => {
  it("reads State and Severity from the URL", () => readsStateAndSeverity());
  it("writes the two keys and keeps the scope", () => writeKeepsTheScope());
  it("joins the scope and the page keys into one request", () => theQueryJoinsScopeAndPage());
  it("lets Critical read all clear only without severity or Suppressed", () => allClearOnlyUnfilteredBySeverityOrSuppressed());
  it("calls a list filtered when any key is set", () => filteredMeansAnyKey());
});
