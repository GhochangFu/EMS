// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCopilotContentFillKeepsEveryOtherStoredSection,
  aFrozenVersionDisablesEveryControl,
  aRefetchedKpiSectionReseedsACleanTab,
  aRefetchKeepsAnEditInProgress,
  aRefusedGrammarChangeLeavesTheRowAlone,
  aStoredV2KpiRendersAsChecked,
  saveOpensTheWizardAndSendsNothing,
  submitSendsTheMergedContentAlone,
  theContentStepShowsEveryExpressionInFull,
  theReviewShowsTheStoredContentBesideTheNew,
  theWizardAloneSendsNoCopilotHeader,
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

  // The fixture (`{kw} * 2` with stored `["kw"]`) cannot show derivation —
  // `pointKeys` is unchanged by the parse either way. This asserts what the
  // Validate path actually writes to the payload; `template-kpi-form.spec.ts`'s
  // `runV2PointKeyDerivationTests` owns the derivation claim itself.
  it("validates an unvalidated KPI under the chosen grammar and saves it as bms-calc-v2, with pointKeys unchanged in the payload", async () => {
    await validateUpgradesToTheChosenGrammar();
  });

  it("refuses a v2 → v1 grammar change in that row, keeps the select on v2, and still saves the row as v2", async () => {
    await aRefusedGrammarChangeLeavesTheRowAlone();
  });

  it("disables every control on a frozen version and offers no Save", async () => {
    await aFrozenVersionDisablesEveryControl();
  });
});

describe("F3.85 PR 11a KPIs tab — Save is the assetTemplate.update wizard (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the wizard on Save and sends nothing yet", async () => {
    await saveOpensTheWizardAndSendsNothing();
  });

  it("lists every KPI expression in full on the content step", async () => {
    await theContentStepShowsEveryExpressionInFull();
  });

  it("submits the merged content alone", async () => {
    await submitSendsTheMergedContentAlone();
  });

  it("reviews the stored content beside the new", async () => {
    await theReviewShowsTheStoredContentBesideTheNew();
  });

  it("sends the PATCH with no X-Copilot-Change header", async () => {
    await theWizardAloneSendsNoCopilotHeader();
  });

  it("merges a copilot content fill over the stored sections, so maintenance survives", async () => {
    await aCopilotContentFillKeepsEveryOtherStoredSection();
  });
});

describe("F3.85 PR 11a KPIs tab — a refetched KPI section (review finding C2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reseeds a clean tab when the stored KPI section changes, and stays clean", async () => {
    await aRefetchedKpiSectionReseedsACleanTab();
  });

  it("keeps an edit in progress when the stored KPI section changes", async () => {
    await aRefetchKeepsAnEditInProgress();
  });
});
