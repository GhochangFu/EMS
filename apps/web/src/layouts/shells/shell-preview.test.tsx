// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { previewDesign, useThemeStore } from "../../stores/theme-store";
import {
  aPreviewSwitchesTheShellAndCancelRestoresIt,
  previewDesignNullClearsTheStorePreview,
  saveKeepsTheSavedValue,
} from "./shell-preview.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  previewDesign(null);
  useThemeStore.getState().setDesign("nexus-soft");
  localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.346 the Appearance preview changes the shell (ADR 0118 Amendment 3 decision 3)", () => {
  it("S5 choosing Swiss Grid on the rail renders the sidebar shell; Cancel restores the rail", () =>
    aPreviewSwitchesTheShellAndCancelRestoresIt());
  it("S5 Save keeps the saved value and clears the preview", () => saveKeepsTheSavedValue());
  it("S5 previewDesign(null) clears the store's preview", () => previewDesignNullClearsTheStorePreview());
});
