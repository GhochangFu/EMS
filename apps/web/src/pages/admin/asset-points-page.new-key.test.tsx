// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCodeTheAssetAlreadyHasWritesNothing,
  aNoWorker503AfterTheKeyIsNotReportedAsNotWritten,
  aCodeOutsideTheCatalogClassIsRefusedByTheSharedSchema,
  aFormulaThatFailsTheCheckCreatesNoKey,
  aRefusedPointAfterTheKeyKeepsThePanelOpen,
  aRefusedPointAfterTheKeyPutsTheKeyInThePicker,
  aRefusedPointAfterTheKeyShowsTheTwoWriteSentence,
  aTakenCodeStillWritesThePoint,
  newKeyIsHiddenFromAnOrganizationAdministrator,
  newKeyIsOfferedToAGlobalAdministrator,
  theCreateSendsTheCodeLabelAndUnit,
  theKeyIsCreatedThenThePointIsWritten,
} from "./asset-points-page.new-key.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.313 — New key in the Add calculated point panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("New key is hidden from an organization administrator", async () => {
    await newKeyIsHiddenFromAnOrganizationAdministrator();
  });

  it("New key is offered to a global administrator", async () => {
    await newKeyIsOfferedToAGlobalAdministrator();
  });

  it("a code outside the catalog class is refused in the shared schema's sentence", async () => {
    await aCodeOutsideTheCatalogClassIsRefusedByTheSharedSchema();
  });

  it("a new code the asset already has writes nothing", async () => {
    await aCodeTheAssetAlreadyHasWritesNothing();
  });

  it("a 503 after the key (point saved) is not reported as not written", async () => {
    await aNoWorker503AfterTheKeyIsNotReportedAsNotWritten();
  });

  it("a formula that fails the check creates no key and writes no point", async () => {
    await aFormulaThatFailsTheCheckCreatesNoKey();
  });

  it("the key is created, then the point is written", async () => {
    await theKeyIsCreatedThenThePointIsWritten();
  });

  it("the create sends the code, label and unit typed", async () => {
    await theCreateSendsTheCodeLabelAndUnit();
  });

  it("a taken code (409) still writes the point", async () => {
    await aTakenCodeStillWritesThePoint();
  });

  it("a refused point after the key shows the two-write sentence", async () => {
    await aRefusedPointAfterTheKeyShowsTheTwoWriteSentence();
  });

  it("a refused point after the key keeps the panel open", async () => {
    await aRefusedPointAfterTheKeyKeepsThePanelOpen();
  });

  it("a refused point after the key re-reads the catalog, so the picker lists the key", async () => {
    await aRefusedPointAfterTheKeyPutsTheKeyInThePicker();
  });
});
