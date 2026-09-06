// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  derivedRowMetadataControlsAreDisabled,
  draftRendersASelectPerRowAndSaveCarriesEveryMeta,
  draftRendersFiveMetadataControlsAndSaveCarriesThem,
  readOnlyRendersMetadataAsText,
  readOnlyRendersTheTierAsText,
} from "./points-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.15 points tab — the Tier column (ADR 0038 Amendment 5 Part A)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the tier as read-only text on a frozen version", async () => {
    await readOnlyRendersTheTierAsText();
  });

  it("offers a tier select per row on a draft, and a save carries every row's meta", async () => {
    await draftRendersASelectPerRowAndSaveCarriesEveryMeta();
  });

  it("offers five metadata controls per row on a draft, and a save carries every row's five (F2.7, ADR 0056 decision 9)", async () => {
    await draftRendersFiveMetadataControlsAndSaveCarriesThem();
  });

  it("renders the five metadata defaults as read-only text on a frozen version", async () => {
    await readOnlyRendersMetadataAsText();
  });

  it("disables the five metadata controls on a derived row", async () => {
    await derivedRowMetadataControlsAreDisabled();
  });
});
