// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aNonNumberIsRefusedWithoutACall,
  clearingSendsNull,
  columnShowsADashForNoRank,
  columnShowsTheRank,
  organizationAdminSeesNoEdit,
  typingTwoSendsTwo,
} from "./point-keys-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.68 point keys page — headline rank", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("W1 shows a ranked key's rank in the Headline rank column", async () => {
    await columnShowsTheRank();
  });

  it("W1b shows — for an unranked key", async () => {
    await columnShowsADashForNoRank();
  });

  it("W2 clearing the field sends headlineRank: null for that key", async () => {
    await clearingSendsNull();
  });

  it("W3 typing 2 sends headlineRank: 2", async () => {
    await typingTwoSendsTwo();
  });

  it("W4 refuses a non-number on the page and calls no API", async () => {
    await aNonNumberIsRefusedWithoutACall();
  });

  it("W5 an organization_admin sees the rows and no Edit button", async () => {
    await organizationAdminSeesNoEdit();
  });
});
