// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adoptIsHiddenFromAnAssetGroupAdmin,
  adoptIsHiddenOnAPinnedAsset,
  adoptIsShownOnATemplateLessAsset,
  adoptOpensTheWizardForThisAsset,
} from "./asset-points-page.adopt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.312 PR 3 — Adopt a template on the asset points page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Adopt is hidden on a pinned asset", async () => {
    await adoptIsHiddenOnAPinnedAsset();
  });
  it("Adopt is shown on a template-less asset", async () => {
    await adoptIsShownOnATemplateLessAsset();
  });
  it("Adopt is hidden from a role that cannot write master data", async () => {
    await adoptIsHiddenFromAnAssetGroupAdmin();
  });
  it("Adopt opens the wizard for this asset", async () => {
    await adoptOpensTheWizardForThisAsset();
  });
});
