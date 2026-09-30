// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  pressingImagesOnARowMountsThatAssetsGallery,
  theAccessDeniedCardLinksToTheControlRoom,
  theHeaderChipShowsTheTypeLabel,
} from "./site-assets-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 SiteAssetsView (moved from the F3.4 location dashboard)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts the gallery for the asset whose Images toggle was pressed", async () => {
    await pressingImagesOnARowMountsThatAssetsGallery();
  });

  it("K5 shows the typeLabel text in the header chip, not the raw type code", async () => {
    await theHeaderChipShowsTheTypeLabel();
  });

  it("links the Access denied card back to the Control Room (OQ8)", async () => {
    await theAccessDeniedCardLinksToTheControlRoom();
  });
});
