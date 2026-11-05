// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aClearedAgeRefusesNextAndSaysWhy,
  aScheduledAddTakesTwiceTheInterval,
  aStreamingAddOpensTheAgeOnThreeHundred,
  aFormulaOnlyFillLeavesTheAgeFollowing,
  aTypedAgeLetsNextPass,
  aTypedAgeSurvivesALaterIntervalEdit,
  anEditKeepsTheStoredAgeOnAnIntervalEdit,
  aPinnedAssetHasNoAddCalculatedPoint,
  aRefusedWriteKeepsTheServersSentenceAfterTheReread,
  aWriteRefusedWith503RereadsBothLists,
  anAddRefusedWith409RereadsBothLists,
  aRefusedDeleteShowsTheServersSentence,
  aWriteRereadsBothLists,
  addSendsTheChosenKeyAndBody,
  anEmptyStandaloneListStillShowsTheCardAndAdd,
  deleteCallsTheDeleteClient,
  eachStandaloneItemHasEditAndDelete,
  whileAWriteIsPendingAddEditAndDeleteAreDisabled,
} from "./asset-points-page.calc-points.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.311 PR 6a — the asset points page's Calculated points card on an asset with no template", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("an empty standalone list still shows the card, its intro and Add calculated point", async () => {
    await anEmptyStandaloneListStillShowsTheCardAndAdd();
  });

  it("an asset pinned to a template has no Add calculated point", async () => {
    await aPinnedAssetHasNoAddCalculatedPoint();
  });

  it("each standalone item has Edit and Delete", async () => {
    await eachStandaloneItemHasEditAndDelete();
  });

  it("Add sends the chosen key and the body Review parsed", async () => {
    await addSendsTheChosenKeyAndBody();
  });

  it("a write re-reads the calc list and the mapping list", async () => {
    await aWriteRereadsBothLists();
  });

  it("Delete calls the delete client", async () => {
    await deleteCallsTheDeleteClient();
  });

  it("a refused Delete shows the server's sentence", async () => {
    await aRefusedDeleteShowsTheServersSentence();
  });

  it("a write refused with 503 re-reads both lists", async () => {
    await aWriteRefusedWith503RereadsBothLists();
  });

  it("an Add refused with 409 re-reads both lists", async () => {
    await anAddRefusedWith409RereadsBothLists();
  });

  it("a refused write keeps the server's sentence after the re-read", async () => {
    await aRefusedWriteKeepsTheServersSentenceAfterTheReread();
  });

  it("while a write is pending, Add, Edit and Delete are disabled", async () => {
    await whileAWriteIsPendingAddEditAndDeleteAreDisabled();
  });
});

describe("F4.315 PR B — Add's default input age, and the Schedule step that refuses", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("streaming opens Inputs valid for on 300", async () => {
    await aStreamingAddOpensTheAgeOnThreeHundred();
  });

  it("scheduled every 30 s opens Inputs valid for on 60", async () => {
    await aScheduledAddTakesTwiceTheInterval();
  });

  it("a cleared age refuses Next, keeps it focusable and says why", async () => {
    await aClearedAgeRefusesNextAndSaysWhy();
  });

  it("a typed age lets Next pass", async () => {
    await aTypedAgeLetsNextPass();
  });

  it("review F1: a typed age survives a later Every edit", async () => {
    await aTypedAgeSurvivesALaterIntervalEdit();
  });

  it("review F2: Edit keeps the stored age when Every changes", async () => {
    await anEditKeepsTheStoredAgeOnAnIntervalEdit();
  });

  it("a formula-only copilot fill leaves the age following its default", async () => {
    await aFormulaOnlyFillLeavesTheAgeFollowing();
  });
});
