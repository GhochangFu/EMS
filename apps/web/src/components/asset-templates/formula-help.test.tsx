// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  clickingAnEntryInsertsItsText,
  disabledDisablesEveryEntry,
  theSectionStartsCollapsed,
  theSummaryNamesTheSection,
  v1ListsExactlyTheFiveFunctions,
  v1ListsNoScope,
  v3ListsTheWindowForms,
} from "./formula-help.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014);
 * jsdom, because the section renders (ADR 0042 decision 2).
 */
describe("F4.314 — the Formula help section", () => {
  afterEach(() => {
    cleanup();
  });

  it("under v1 lists exactly the five CALC_FUNCTION_ARITY functions", () => {
    v1ListsExactlyTheFiveFunctions();
  });

  it("under v1 lists no scope", () => {
    v1ListsNoScope();
  });

  it("under v3 lists the window forms", () => {
    v3ListsTheWindowForms();
  });

  it("clicking Insert round hands round( to onInsert", async () => {
    await clickingAnEntryInsertsItsText();
  });

  it("disabled disables every entry", () => {
    disabledDisablesEveryEntry();
  });

  it("starts collapsed", () => {
    theSectionStartsCollapsed();
  });

  it("names the section Formula help in its summary", () => {
    theSummaryNamesTheSection();
  });
});
