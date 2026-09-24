import { render } from "@testing-library/react";
import { expect } from "vitest";

import type { WidgetIcon } from "@bms/shared";

import { WIDGET_ICON_PATH } from "../lib/widget-catalog";
import { WidgetIconGlyph } from "./widget-icon";

/**
 * `F3.28` task 2.4 — `WidgetIconGlyph`, extracted verbatim from
 * `value-tile-widget.tsx` so the KPI ribbon and `/cr-overview` (tasks 2.5, 2.7)
 * can render the same glyph. `WIDGET_ICON_PATH` is the closed vocabulary
 * (ADR 0048 decision 6); each `it()` below asserts on one icon name so a
 * mutation to one path's rendering does not hide behind another's pass.
 */

/** Renders the glyph for every icon name and asserts its `<path d>` matches
 * the vocabulary — the rendered marker that distinguishes one icon from
 * another. */
export function rendersEachIconNameWithItsOwnPathData(): void {
  for (const name of Object.keys(WIDGET_ICON_PATH) as WidgetIcon[]) {
    const { container } = render(<>{WidgetIconGlyph(name)}</>);
    const path = container.querySelector("svg > path");
    expect(path, `icon ${name} must render a path`).not.toBeNull();
    expect(path?.getAttribute("d")).toBe(WIDGET_ICON_PATH[name]);
    container.remove();
  }
}

/** No icon name renders nothing — not an empty `<svg>`. */
export function rendersNothingWhenNoIconNameIsGiven(): void {
  const { container } = render(<>{WidgetIconGlyph(undefined)}</>);
  expect(container.querySelector("svg")).toBeNull();
}
