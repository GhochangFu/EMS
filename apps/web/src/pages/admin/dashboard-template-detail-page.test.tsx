// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addWidgetAddsAWidgetEditor,
  draftShowsPublishAndDelete,
  publishedShowsArchiveAndInstantiate,
  resolutionReportNamesAPartialWidget,
} from "./dashboard-template-detail-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.36 dashboard template detail page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a draft offers Publish and Delete, never Archive or Instantiate", async () => {
    await draftShowsPublishAndDelete();
  });

  it("a published version offers Archive and Instantiate, never Publish or Delete", async () => {
    await publishedShowsArchiveAndInstantiate();
  });

  it("the instantiate dialog names a partial widget with its counts (ADR 0049 Amendment 2)", async () => {
    await resolutionReportNamesAPartialWidget();
  });

  it("adding a widget grows the canvas with a vocabulary-fed role picker", async () => {
    await addWidgetAddsAWidgetEditor();
  });
});
