// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  admitsAnAssetGroupAdmin,
  sendsAnOperatorToTheDashboard,
  sendsAViewerToTheDashboard,
  stillAdmitsALocationAdmin,
} from "./dashboard-author-route.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.63 dashboard author route gate", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admits an asset_group_admin to the builder", () => {
    admitsAnAssetGroupAdmin();
  });

  it("still admits a location_admin to the builder", () => {
    stillAdmitsALocationAdmin();
  });

  it("sends an operator to the dashboard", () => {
    sendsAnOperatorToTheDashboard();
  });

  it("sends a viewer to the dashboard", () => {
    sendsAViewerToTheDashboard();
  });
});
