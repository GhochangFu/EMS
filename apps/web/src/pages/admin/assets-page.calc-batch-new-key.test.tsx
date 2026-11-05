// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aBackfillRunning409AfterTheKeyIsNotReportedAsNotWritten,
  aCodeOutsideTheCatalogClassIsRefusedByTheSharedSchema,
  aFormulaThatFailsOnOneAssetCreatesNoKey,
  aFormulaThatFailsOnOneAssetListsThatAsset,
  aRefusedBatchAfterTheKeyPutsTheKeyInThePicker,
  aRefusedBatchAfterTheKeyShowsTheTwoWriteSentence,
  aRefusedBatchAfterTheKeyStillListsTheRefusedAssets,
  aTakenCodeStillWritesTheBatch,
  newKeyIsHiddenFromAnOrganizationAdministrator,
  newKeyIsOfferedToAGlobalAdministrator,
  theKeyIsCreatedThenTheBatchIsWritten,
} from "./assets-page.calc-batch-new-key.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.313 — New key in the asset list's bulk calculated-point wizard", () => {
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

  it("a formula that fails on one asset creates no key and writes no batch", async () => {
    await aFormulaThatFailsOnOneAssetCreatesNoKey();
  });

  it("a formula that fails on one asset lists that asset", async () => {
    await aFormulaThatFailsOnOneAssetListsThatAsset();
  });

  it("the key is created, then the batch is written", async () => {
    await theKeyIsCreatedThenTheBatchIsWritten();
  });

  it("a taken code (409) still writes the batch", async () => {
    await aTakenCodeStillWritesTheBatch();
  });

  it("a refused batch after the key shows the two-write sentence", async () => {
    await aRefusedBatchAfterTheKeyShowsTheTwoWriteSentence();
  });

  it("a batch 409 after the key (points written) is not reported as not written", async () => {
    await aBackfillRunning409AfterTheKeyIsNotReportedAsNotWritten();
  });

  it("a refused batch after the key still lists the refused assets", async () => {
    await aRefusedBatchAfterTheKeyStillListsTheRefusedAssets();
  });

  it("a refused batch after the key re-reads the catalog, so the picker lists the key", async () => {
    await aRefusedBatchAfterTheKeyPutsTheKeyInThePicker();
  });
});
