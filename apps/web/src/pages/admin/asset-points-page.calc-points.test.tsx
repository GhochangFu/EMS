// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aPinnedAssetHasNoAddCalculatedPoint,
  aRefusedDeleteShowsTheServersSentence,
  aWriteRereadsBothLists,
  addSendsTheChosenKeyAndBody,
  anEmptyStandaloneListStillShowsTheCardAndAdd,
  deleteCallsTheDeleteClient,
  eachStandaloneItemHasEditAndDelete,
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
});
