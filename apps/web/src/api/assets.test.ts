import { afterEach, describe, it, vi } from "vitest";

import {
  roleSummaryHitsTheRoleSummaryPath,
  roleSummarySendsOneAssetIdsPerIdInOrder,
} from "./assets.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.28 assets web client — what the class strip's fetcher sends", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the role summary read to /api/v1/assets/role-summary", async () => {
    await roleSummaryHitsTheRoleSummaryPath();
  });

  it("sends one assetIds per id, in order, on the role summary read", async () => {
    await roleSummarySendsOneAssetIdsPerIdInOrder();
  });
});
