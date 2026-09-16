// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { pressingImagesOnARowMountsThatAssetsGallery } from "./location-dashboard-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.4 location dashboard reader gallery (Q-1 option A)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts the gallery for the asset whose Images toggle was pressed", async () => {
    await pressingImagesOnARowMountsThatAssetsGallery();
  });
});
