// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  noInstanceOpensTheFilteredList,
  opensTheNewestInstanceBySlug,
  theEntryAsksTheApiForTheSection,
  theErrorStateShowsTheApiMessage,
  theLoadingStateNamesWhatItIsOpening,
  theRedirectCarriesTheOrganizationId,
} from "./sustainability-entry-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("E4.2 sustainability entry page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the newest instance by createdAt, not the first by slug", async () => {
    await opensTheNewestInstanceBySlug();
  });

  it("carries organizationId on the redirect", async () => {
    await theRedirectCarriesTheOrganizationId();
  });

  it("opens the filtered list when the section has no instance", async () => {
    await noInstanceOpensTheFilteredList();
  });

  it("asks the API for the section rather than filtering client-side", async () => {
    await theEntryAsksTheApiForTheSection();
  });

  it("names what it is opening while the list is pending", () => {
    theLoadingStateNamesWhatItIsOpening();
  });

  it("shows the API message on a failed read, and does not redirect", async () => {
    await theErrorStateShowsTheApiMessage();
  });
});
