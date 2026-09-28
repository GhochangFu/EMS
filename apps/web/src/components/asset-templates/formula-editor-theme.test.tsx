// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import {
  e1MountedInDarkTheFacetIsDark,
  e2MountedInLightTheFacetIsLight,
  e3ALightToDarkToggleAfterMountFlipsTheFacet,
  e4TheDrawnCursorIsInk,
  e5TheFocusedSelectionIsInfoWash,
  e6TheUnfocusedSelectionIsWell,
  e7TheTooltipIsSurfaceInkAndLineStrong,
  e8TheEditorTextIsInk,
} from "./formula-editor-theme.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom, because the
 * editor mounts and the theme store writes `data-theme` on `<html>`.
 */
describe("F3.65c the formula editor follows the theme", () => {
  afterEach(() => {
    cleanup();
    useThemeStore.getState().setTheme("light");
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("E1 mounted in dark, EditorView.darkTheme is true", () => {
    e1MountedInDarkTheFacetIsDark();
  });

  it("E2 mounted in light, EditorView.darkTheme is false", () => {
    e2MountedInLightTheFacetIsLight();
  });

  it("E3 a light-to-dark toggle after mount flips EditorView.darkTheme to true", () => {
    e3ALightToDarkToggleAfterMountFlipsTheFacet();
  });

  it("E4 the drawn cursor's border is ink", () => {
    e4TheDrawnCursorIsInk();
  });

  it("E5 the focused selection, at the base rule's own selector, is info-wash", () => {
    e5TheFocusedSelectionIsInfoWash();
  });

  it("E6 the unfocused selection is well", () => {
    e6TheUnfocusedSelectionIsWell();
  });

  it("E7 the completion and lint tooltip is surface, ink, line-strong border", () => {
    e7TheTooltipIsSurfaceInkAndLineStrong();
  });

  it("E8 the editor's own text is ink", () => {
    e8TheEditorTextIsInk();
  });
});
