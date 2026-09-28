// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFailedStockFetchDoesNotCountZeroDefaults,
  anotherEntryKeepsItsNameWhileOneImports,
  importCallsTheApiWithTheChosenOrganization,
  importingAnnouncesImportingThisEntry,
  importingRemovesThatEntrysIdleName,
  rendersTemplatesAndStockCatalog,
  sectionFilterComesFromTheVocabularyFetch,
  stockRowLinksToTheViewer,
} from "./dashboard-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.36 dashboard templates list page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the template list and the stock catalog with an Import action each", async () => {
    await rendersTemplatesAndStockCatalog();
  });

  it("builds the section filter from the vocabulary fetch, never a hardcoded list", async () => {
    await sectionFilterComesFromTheVocabularyFetch();
  });

  it("imports a stock entry into the chosen organization", async () => {
    await importCallsTheApiWithTheChosenOrganization();
  });

  it("links the stock row to the read-only viewer", async () => {
    await stockRowLinksToTheViewer();
  });

  it("does not count zero defaults when the stock fetch fails", async () => {
    await aFailedStockFetchDoesNotCountZeroDefaults();
  });

  it("B5 importing announces Importing {name}… as the aria-label, with aria-busy", async () => {
    await importingAnnouncesImportingThisEntry();
  });

  it("B5 importing removes that entry's idle Import {name} name", async () => {
    await importingRemovesThatEntrysIdleName();
  });

  it("B5 another stock entry keeps Import {name} and is not busy while one imports", async () => {
    await anotherEntryKeepsItsNameWhileOneImports();
  });
});
