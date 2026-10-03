// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusedSaveShowsTheServersSentence,
  offDisablesTheKeyField,
  platformDefaultCallsDelete,
  rendersKeySetEndsInLast4,
  rendersThePlatformDefaultWhenNoRow,
  saveWithoutAKeyOmitsApiKey,
  testShowsTheStatusSentence,
  theKeyFieldIsWriteOnlyAndClearedAfterSave,
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
});
