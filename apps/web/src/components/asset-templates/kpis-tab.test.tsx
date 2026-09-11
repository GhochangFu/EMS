// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFrozenVersionDisablesEveryControl,
  aRefusedGrammarChangeLeavesTheRowAlone,
  aStoredV2KpiRendersAsChecked,
  validateUpgradesToTheChosenGrammar,
} from "./kpis-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.22 KPIs tab — a bms-calc-v2 KPI is checked, and Grammar (ADR 0055)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a stored bms-calc-v2 KPI as checked, with no manual points list and Grammar reading v2", async () => {
    await aStoredV2KpiRendersAsChecked();
  });

  it("validates an unvalidated KPI under the chosen grammar and saves it as bms-calc-v2 with derived pointKeys", async () => {
    await validateUpgradesToTheChosenGrammar();
  });

  it("refuses a v2 → v1 grammar change in that row, keeps the select on v2, and still saves the row as v2", async () => {
    await aRefusedGrammarChangeLeavesTheRowAlone();
  });

  it("disables every control on a frozen version and offers no Save", async () => {
    await aFrozenVersionDisablesEveryControl();
  });
});
