// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { useThemeStore } from "../stores/theme-store";
import {
  m1AToggleRepaintsAHealthyMarkerFillWithTheDarkAccent,
  m2AToggleRepaintsTheMarkerStrokeWithTheDarkChrome,
  resetRecorded,
} from "./world-map-follows-theme.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom, because the map
 * renders and the theme store writes `data-theme` on `<html>`.
 */
describe("F3.65c the world map follows the theme", () => {
  afterEach(() => {
    cleanup();
    resetRecorded();
    useThemeStore.getState().setTheme("light");
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("M1 a light-to-dark toggle repaints a healthy marker's fill with the dark accent", () => {
    m1AToggleRepaintsAHealthyMarkerFillWithTheDarkAccent();
  });

  it("M2 a light-to-dark toggle repaints the marker stroke with the dark chrome", () => {
    m2AToggleRepaintsTheMarkerStrokeWithTheDarkChrome();
  });
});
