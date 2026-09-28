import { act, render } from "@testing-library/react";
import { expect } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import { CALC_THEME_SPEC, FormulaEditor, editorIsDark } from "./formula-editor";

/**
 * `F3.65c` review — the formula editor follows the theme (ADR 0078 Amendment 3).
 *
 * `@codemirror/view`'s base theme carries `&light` and `&dark` rules (the drawn cursor, the
 * selection, the tooltips). Which of the two applies is the `EditorView.darkTheme` facet, and
 * nothing set it, so a dark page kept the light cursor, selection and tooltip. This spec reads the
 * facet through `editorIsDark` — `tests/adr-0038-formula-editor.test.ts` allows no CodeMirror
 * import outside `formula-editor.tsx`, specs included — and reads the theme's own rules from
 * `CALC_THEME_SPEC`, keyed by the exact selector, so a rule written at a lower specificity than
 * the base rule it must beat fails here rather than in a browser.
 *
 * The cascade itself (that the equal-specificity rule wins because a base theme mounts first) is
 * a browser claim — plan §6 row 10.
 */

function mount(): HTMLElement {
  const { container } = render(
    <FormulaEditor
      mode="kpi"
      declaredPointKeys={[]}
      kpiPointKeys={[]}
      dialect="unvalidated"
      value="1 + 2"
      onChange={() => undefined}
    />,
  );
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  if (!editor) throw new Error("the formula editor mounted no .cm-editor");
  return editor;
}

export function e1MountedInDarkTheFacetIsDark(): void {
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(editorIsDark(mount())).toBe(true);
}

export function e2MountedInLightTheFacetIsLight(): void {
  expect(editorIsDark(mount())).toBe(false);
}

export function e3ALightToDarkToggleAfterMountFlipsTheFacet(): void {
  const editor = mount();
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(editorIsDark(editor)).toBe(true);
}

export function e4TheDrawnCursorIsInk(): void {
  expect(CALC_THEME_SPEC[".cm-cursor, .cm-dropCursor"]).toEqual({ borderLeftColor: "rgb(var(--ink))" });
}

export function e5TheFocusedSelectionIsInfoWash(): void {
  expect(
    CALC_THEME_SPEC["&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground"],
  ).toEqual({ background: "rgb(var(--info-wash))" });
}

export function e6TheUnfocusedSelectionIsWell(): void {
  expect(CALC_THEME_SPEC[".cm-selectionBackground"]).toEqual({ background: "rgb(var(--well))" });
}

export function e7TheTooltipIsSurfaceInkAndLineStrong(): void {
  expect(CALC_THEME_SPEC[".cm-tooltip"]).toEqual({
    backgroundColor: "rgb(var(--surface))",
    color: "rgb(var(--ink))",
    border: "1px solid rgb(var(--line-strong))",
  });
}

/** The base rule is `&light/&dark .cm-tooltip-autocomplete ul li[aria-selected]` (`#17c`/`#347`). */
export function e9TheSelectedCompletionIsAccentStrongWithOnAccent(): void {
  expect(CALC_THEME_SPEC[".cm-tooltip-autocomplete ul li[aria-selected]"]).toEqual({
    background: "rgb(var(--accent-strong))",
    color: "rgb(var(--on-accent))",
  });
}

export function e8TheEditorTextIsInk(): void {
  expect(CALC_THEME_SPEC["&"]).toMatchObject({ color: "rgb(var(--ink))" });
}
