// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aClearedVisionModelIsOmitted,
  aRefusedSaveShowsTheServersSentence,
  offDisablesTheKeyField,
  offDisablesTheVisionModelField,
  platformDefaultCallsDelete,
  rendersKeySetEndsInLast4,
  rendersThePlatformDefaultWhenNoRow,
  saveSendsTheVisionModel,
  saveWithoutAKeyOmitsApiKey,
  testShowsBothChecks,
  testShowsTheStatusSentence,
  theKeyFieldIsWriteOnlyAndClearedAfterSave,
  thePageCarriesTheAttachmentSwitch,
  theVisionModelFieldShowsTheStoredValueAndHelp,
} from "./ai-assistant-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.21 AI assistant page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the platform default when the organization has no row", async () => {
    await rendersThePlatformDefaultWhenNoRow();
  });

  it("renders Key set, ends in the last four, with the date", async () => {
    await rendersKeySetEndsInLast4();
  });

  it("keeps the key field write-only and empties it after a save", async () => {
    await theKeyFieldIsWriteOnlyAndClearedAfterSave();
  });

  it("omits apiKey when Save runs with the key field empty", async () => {
    await saveWithoutAKeyOmitsApiKey();
  });

  it("saves Platform default as a DELETE", async () => {
    await platformDefaultCallsDelete();
  });

  it("shows the test status as a sentence and no key text", async () => {
    await testShowsTheStatusSentence();
  });

  it("disables the key field and Test for Off", async () => {
    await offDisablesTheKeyField();
  });

  it("shows the server's sentence for a refused save, with no envelope", async () => {
    await aRefusedSaveShowsTheServersSentence();
  });

  it("F3.87 carries the attachment switch and its unscrubbed sentence", async () => {
    await thePageCarriesTheAttachmentSwitch();
  });

  it("F4.267 shows Model for images from the stored value, with its help line", async () => {
    await theVisionModelFieldShowsTheStoredValueAndHelp();
  });

  it("F4.267 resends the vision model on Save", async () => {
    await saveSendsTheVisionModel();
  });

  it("F4.267 omits visionModel when the field is cleared", async () => {
    await aClearedVisionModelIsOmitted();
  });

  it("F4.267 shows both Test checks, one line each", async () => {
    await testShowsBothChecks();
  });

  it("F4.267 disables Model for images for Off", async () => {
    await offDisablesTheVisionModelField();
  });
});
