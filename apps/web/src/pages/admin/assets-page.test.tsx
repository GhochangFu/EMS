// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  closeRemovesThePanelAndLeavesTheRow,
  editOfALiveStoredRoleOffersNoRetiredOption,
  editOfARetiredStoredRoleKeepsItsValue,
  editOfARetiredStoredRoleOffersItMarkedRetired,
  editPrefillsTheStoredRole,
  imagesOpensThePanelForThatRow,
  roleSelectOffersTheVocabularyAfterAnEmptyOption,
  savingWithARoleSendsIt,
  savingWithNoRoleSendsNull,
} from "./assets-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F3.4 assets page image panel (Q-0, Q-2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the images panel for the row whose Images action was pressed", async () => {
    await imagesOpensThePanelForThatRow();
  });

  it("closes the panel without disturbing the list", async () => {
    await closeRemovesThePanelAndLeavesTheRow();
  });
});

/** `E4.3` U3 (ADR 0073 decision 1) — the water balance role on the asset form. */
describe("E4.3 assets page water balance role", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers Not in the balance, then the vocabulary's four roles", async () => {
    await roleSelectOffersTheVocabularyAfterAnEmptyOption();
  });

  it("sends the selected role on save", async () => {
    await savingWithARoleSendsIt();
  });

  it("sends null when no role is selected", async () => {
    await savingWithNoRoleSendsNull();
  });

  it("prefills the select from the row's stored role on edit", async () => {
    await editPrefillsTheStoredRole();
  });

  it("keeps a retired stored role as the select's value on edit (sweep L1)", async () => {
    await editOfARetiredStoredRoleKeepsItsValue();
  });

  it("offers the retired stored role as an option marked (retired) (sweep L1)", async () => {
    await editOfARetiredStoredRoleOffersItMarkedRetired();
  });

  it("offers no (retired) option when the stored role is live (sweep L1 control)", async () => {
    await editOfALiveStoredRoleOffersNoRetiredOption();
  });
});
