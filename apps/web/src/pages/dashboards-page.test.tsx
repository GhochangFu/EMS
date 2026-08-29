// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anAuthoringRoleSeesTheManageLink,
  rendersEveryRowTheApiReturns,
  viewerRoleSeesNoAuthoringAffordance,
} from "./dashboards-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboards page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a viewer no authoring affordance", async () => {
    await viewerRoleSeesNoAuthoringAffordance();
  });

  it("shows an authoring role the Manage dashboards link", async () => {
    await anAuthoringRoleSeesTheManageLink();
  });

  it("renders every row the API returns, without re-deriving visibility", async () => {
    await rendersEveryRowTheApiReturns();
  });
});
