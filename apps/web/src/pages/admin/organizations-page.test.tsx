// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  editPrefillsTheCurrencyAndSendsIt,
  formHasACurrencyInputWithADatalist,
  listRendersTheCurrencyColumn,
  saveAnnouncesSavingWhilePending,
  saveIsNamedSaveAndNotBusyAtIdle,
  saveLosesItsIdleNameWhilePending,
  theAiAssistantActionIsHiddenWithoutAccess,
  theAiAssistantActionNavigatesToTheSubPage,
  typedCurrencyIsUppercasedAndSubmitted,
} from "./organizations-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("E4.1c organizations page — the Currency field", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("O1 the form has a Currency input bound to a datalist with at least one option", async () => {
    await formHasACurrencyInputWithADatalist();
  });

  it("O2 a typed inr is submitted as currency: INR", async () => {
    await typedCurrencyIsUppercasedAndSubmitted();
  });

  it("O3 the list has a Currency column carrying each row's code", async () => {
    await listRendersTheCurrencyColumn();
  });

  it("O4 editing a row prefills the Currency input and the update sends it", async () => {
    await editPrefillsTheCurrencyAndSendsIt();
  });

  it("B1 Save is named Save and not busy at idle", async () => {
    await saveIsNamedSaveAndNotBusyAtIdle();
  });

  it("B1 Save announces Saving… with aria-busy while pending", async () => {
    await saveAnnouncesSavingWhilePending();
  });

  it("B1 the idle name Save is gone while pending", async () => {
    await saveLosesItsIdleNameWhilePending();
  });

  it("F3.21 the AI assistant action opens the row's sub-page for an organization_admin", async () => {
    await theAiAssistantActionNavigatesToTheSubPage();
  });

  it("F3.21 the AI assistant action is hidden from a role without access", async () => {
    await theAiAssistantActionIsHiddenWithoutAccess();
  });
});
