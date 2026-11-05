// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCheckboxDoesNotOpenTheAssetsPoints,
  aRefusedBatchRereadsTheAssetList,
  aTemplatedAssetIsLeftOutOfTheRequestBody,
  aSearchClearsTheSelection,
  aTemplatedAssetIsMarkedAndLeftOut,
  reviewListsEveryRefusedAsset,
  theBatchSendsExactlyTheCheckedIds,
  theBulkWizardKeepsATypedAgeOnALaterIntervalEdit,
  theBulkWizardRefusesNextWhileTheAgeIsEmpty,
  theBulkWizardTakesTwiceTheInterval,
  theBulkWizardListsTheSharedOrganizationsVersion,
  theBulkWizardMarksNoInputMissing,
  theFormulaStepCarriesTheQualifiedReferenceSentence,
  twentySixCheckedDisablesTheButtonWithTheCapSentence,
} from "./assets-page.calc-batch.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.311 PR 6a — the asset list's Add calculated point bulk action", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the batch sends exactly the checked ids", async () => {
    await theBatchSendsExactlyTheCheckedIds();
  });

  it("26 checked disables the button, with the cap sentence", async () => {
    await twentySixCheckedDisablesTheButtonWithTheCapSentence();
  });

  it("a selected asset with a template is marked and left out", async () => {
    await aTemplatedAssetIsMarkedAndLeftOut();
  });

  it("the Formula step carries ADR 0109's {ASSET_CODE.key} sentence", async () => {
    await theFormulaStepCarriesTheQualifiedReferenceSentence();
  });

  it("Review lists every refused asset from the server's 400", async () => {
    await reviewListsEveryRefusedAsset();
  });

  it("a search clears the selection", async () => {
    await aSearchClearsTheSelection();
  });

  it("checking a row checks it and stays on the list", async () => {
    await aCheckboxDoesNotOpenTheAssetsPoints();
  });

  it("a templated asset in the selection is left out of the request body", async () => {
    await aTemplatedAssetIsLeftOutOfTheRequestBody();
  });

  it("a refused batch re-reads the asset list", async () => {
    await aRefusedBatchRereadsTheAssetList();
  });

  it("the Formula step's Suggested formulas read the selection's shared organization (F4.314)", async () => {
    await theBulkWizardListsTheSharedOrganizationsVersion();
  });

  it("the Formula step's Suggested formulas mark no input missing (F4.314)", async () => {
    await theBulkWizardMarksNoInputMissing();
  });
});

describe("F4.315 PR B — the bulk wizard's default input age, and the Schedule step that refuses", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("scheduled every 30 s opens Inputs valid for on 60", async () => {
    await theBulkWizardTakesTwiceTheInterval();
  });

  it("an empty age refuses Next, keeps it focusable and says why", async () => {
    await theBulkWizardRefusesNextWhileTheAgeIsEmpty();
  });

  it("review F1: a typed age survives a later Every edit", async () => {
    await theBulkWizardKeepsATypedAgeOnALaterIntervalEdit();
  });
});
