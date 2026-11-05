// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  takingFillsTheFormula,
  takingSetsEvery,
  takingSetsInputsValidFor,
  takingSetsRuns,
  takingSetsTheGrammar,
  thePanelMarksTheMissingInput,
} from "./point-calc-override-panel.suggestions.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.314 PR 2 — Suggested formulas on the override panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("taking a suggestion fills the formula", async () => {
    await takingFillsTheFormula();
  });

  it("taking a suggestion sets the Grammar", async () => {
    await takingSetsTheGrammar();
  });

  it("taking a suggestion sets Runs", async () => {
    await takingSetsRuns();
  });

  it("taking a suggestion sets Every", async () => {
    await takingSetsEvery();
  });

  it("taking a suggestion sets Inputs valid for", async () => {
    await takingSetsInputsValidFor();
  });

  it("the panel marks the input the asset does not have", async () => {
    await thePanelMarksTheMissingInput();
  });
});
