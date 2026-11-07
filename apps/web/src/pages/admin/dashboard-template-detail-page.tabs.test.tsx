// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFlattenedServer400SelectsNoTab,
  aPublishedSiteTemplateHasNoTabInputs,
  aRefusalAtATabWidgetSelectsThatTab,
  anAddedTabIsCountedAndSent,
  saveSendsTheRenamedTab,
} from "./dashboard-template-detail-page.tabs.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the file it collects
 * (ADR 0042 decision 2).
 */
describe("F4.320 the detail page edits a site template's tabs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Save sends the renamed tab in content.tabs", async () => {
    await saveSendsTheRenamedTab();
  });

  it("a tab and a widget added on screen are counted and sent", async () => {
    await anAddedTabIsCountedAndSent();
  });

  it("a refusal at content.tabs.1.widgets.0.config selects tab 2", async () => {
    await aRefusalAtATabWidgetSelectsThatTab();
  });

  it("the API's flattened 400 selects no tab", async () => {
    await aFlattenedServer400SelectsNoTab();
  });

  it("a published site template shows the strip and no tab input", async () => {
    await aPublishedSiteTemplateHasNoTabInputs();
  });
});
