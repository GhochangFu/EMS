// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCatalogSegmentOffersNoReset,
  addThenSaveSendsThePutWithTheOrderedList,
  failsClosedForALocationAdmin,
  moveUpChangesTheSentOrder,
  removeTakesTheCodeOutOfTheSentList,
  rendersOneCardPerSegmentWithItsLabel,
  resetSendsAnEmptyList,
  saveIsDisabledOnAnUnchangedCatalogCard,
  theAddControlIsAbsentAtTheCap,
  theBadgeNamesTheSource,
  thePickerOffersOnlyTheSegmentsMissingCodes,
  thePickerOffersOtherSegmentsCodesInTheirOwnGroup,
} from "./trend-points-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.300 Trend Points admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("T1 renders one card per segment, headed by its label", async () => {
    await rendersOneCardPerSegmentWithItsLabel();
  });

  it("T2 the badge reads Catalog default or Organization", async () => {
    await theBadgeNamesTheSource();
  });

  it("T3a the Add picker lists the segment's own missing codes first, outside any group", async () => {
    await thePickerOffersOnlyTheSegmentsMissingCodes();
  });

  it("T3f the picker offers other segments' codes in their own group, and Save sends one", async () => {
    await thePickerOffersOtherSegmentsCodesInTheirOwnGroup();
  });

  it("T3b Add then Save sends PUT /admin/organizations/<id>/trend-points/<domain> with the ordered list", async () => {
    await addThenSaveSendsThePutWithTheOrderedList();
  });

  it("T3c Move up changes the order Save sends", async () => {
    await moveUpChangesTheSentOrder();
  });

  it("T3e Save is disabled on an unchanged catalog card, enabled after a change", async () => {
    await saveIsDisabledOnAnUnchangedCatalogCard();
  });

  it("T3d Remove takes the code out of the list Save sends", async () => {
    await removeTakesTheCodeOutOfTheSentList();
  });

  it("T4 Reset to catalog sends pointKeys: []", async () => {
    await resetSendsAnEmptyList();
  });

  it("T4b a catalog segment offers no Reset", async () => {
    await aCatalogSegmentOffersNoReset();
  });

  it("T5 the Add control is absent when the list holds 12", async () => {
    await theAddControlIsAbsentAtTheCap();
  });

  it("T6 fails closed for a location_admin: the sentence, no form, no read", async () => {
    await failsClosedForALocationAdmin();
  });
});
