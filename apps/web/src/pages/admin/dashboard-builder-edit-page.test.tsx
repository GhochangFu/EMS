// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { savingDoesNotSendAnAssetGroupIdKey } from "./dashboard-builder-edit-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard builder edit page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("never sends an assetGroupId key when saving", async () => {
    await savingDoesNotSendAnAssetGroupIdKey();
  });
});
