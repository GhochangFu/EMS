// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aPublishedVersionDisablesUse,
  takingFillsTheRowsFormula,
  takingSetsTheRowsEvery,
  takingSetsTheRowsGrammar,
  takingSetsTheRowsInputAge,
  takingSetsTheRowsRuns,
  theTabsOwnVersionIsNotRead,
} from "./calculations-tab.suggestions.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.314 PR 2 — Suggested formulas on the Calculations tab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("taking a suggestion fills the row's formula", async () => {
    await takingFillsTheRowsFormula();
  });

  it("taking a suggestion sets the row's Grammar", async () => {
    await takingSetsTheRowsGrammar();
  });

  it("taking a suggestion sets the row's Runs", async () => {
    await takingSetsTheRowsRuns();
  });

  it("taking a suggestion sets the row's Every", async () => {
    await takingSetsTheRowsEvery();
  });

  it("taking a suggestion sets the row's Ignore inputs older than", async () => {
    await takingSetsTheRowsInputAge();
  });

  it("never reads the tab's own version", async () => {
    await theTabsOwnVersionIsNotRead();
  });

  it("disables Use this formula on a published version", async () => {
    await aPublishedVersionDisablesUse();
  });
});
