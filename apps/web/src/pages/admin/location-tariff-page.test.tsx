// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./location-tariff-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6); the jsdom
 * docblock is on this file because Vitest reads it from the file it collects (ADR 0042).
 */
describe("F4.365 U8 location tariff page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the mapping with its Verify badge", async () => {
    await spec.rendersTheMappingWithItsVerifyBadge();
  });

  it("an official line shows no Verify badge", async () => {
    await spec.anOfficialLineShowsNoVerifyBadge();
  });

  it("the category list narrows by state", async () => {
    await spec.theCategoryListNarrowsByState();
  });

  it("the search narrows the category list", async () => {
    await spec.theSearchNarrowsTheCategoryList();
  });

  it("a secondary line shows Verify in the form", async () => {
    await spec.aSecondaryLineShowsVerifyInTheForm();
  });

  it("the unit select is locked to kVA for a per-kVA basis", async () => {
    await spec.theUnitSelectIsLockedForAPerKvaBasis();
  });

  it("the POST body is the contract's shape", async () => {
    await spec.thePostBodyIsTheContractShape();
  });

  it("the server's 409 sentence is rendered", async () => {
    await spec.theServerConflictSentenceIsRendered();
  });

  it("an incomplete form is held without a request", async () => {
    await spec.anIncompleteFormIsHeldWithoutARequest();
  });

  it("edit sends the window without the line", async () => {
    await spec.editSendsTheWindowWithoutTheLine();
  });

  it("delete asks with confirm() before sending", async () => {
    await spec.deleteAsksBeforeSending();
  });

  it("End sets the end to the first day of next month, in the location's zone", async () => {
    await spec.endSetsTheEndToNextMonth();
  });

  it("the add form's From month is this month in the location's zone", async () => {
    await spec.theAddFormDefaultsToTheLocationsMonth();
  });

  it("a role without the gate sees no write control", async () => {
    await spec.aRoleWithoutTheGateSeesNoWriteControl();
  });
});
