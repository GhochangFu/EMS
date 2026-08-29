// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aLocationAdminStillSeesTheEditLink,
  assetGroupAdminSeesNoEditLinkDespiteCanAuthorDashboards,
} from "./dashboard-viewer-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard viewer page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an asset_group_admin no Edit dashboard link, despite canAuthorDashboards", async () => {
    await assetGroupAdminSeesNoEditLinkDespiteCanAuthorDashboards();
  });

  it("still shows a location_admin the Edit dashboard link", async () => {
    await aLocationAdminStillSeesTheEditLink();
  });
});
