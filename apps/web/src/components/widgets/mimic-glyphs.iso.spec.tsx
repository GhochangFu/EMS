import { render } from "@testing-library/react";
import { expect } from "vitest";

import { MimicGlyph, isoTankLevelPath, tankFillPath } from "./mimic-glyphs";
import { ensureLibraryShapes } from "./mimic-symbol-libraries";
import { ISO_LEVEL_BOXES } from "./mimic-symbol-libraries/iso.level-boxes.generated";

/**
 * `F4.345` (ADR 0121 decisions 5 and 6, plan T3.3) — `MimicGlyph` under the `iso` glyph set: a core
 * kind draws its isometric twin in the fill style, the tank keeps its live level inside the twin's
 * generated level box, and a kind with no twin is unchanged. `mimic-glyphs.iso.test.tsx` is the
 * Vitest entry (ADR 0014).
 */

function glyphOf(container: HTMLElement): Element {
  const g = container.querySelector("[data-testid=mimic-glyph]");
  expect(g, "a glyph is drawn").not.toBeNull();
  return g as Element;
}

/** GI1 — `tank` with `glyphSet="iso"` draws `iso:tank` in the fill style with the role's fill class. */
export async function anIsoTankDrawsItsTwinFilled(): Promise<void> {
  await ensureLibraryShapes(["iso"]);
  const { container } = render(
    <svg>
      <MimicGlyph kind="tank" glyphSet="iso" x={0} y={0} size={60} className="stroke-info" />
    </svg>,
  );
  const g = glyphOf(container);
  expect(g.getAttribute("data-glyph")).toBe("iso:tank");
  expect(g.getAttribute("data-glyph-style")).toBe("fill");
  expect(g.getAttribute("class") ?? "").toContain("fill-info");
  expect(g.hasAttribute("data-glyph-fallback")).toBe(false);
}

/** GI2 — the isometric tank's level is drawn from its level box: `data-level`, the exact path, no stroke. */
export async function anIsoTankKeepsItsLiveLevel(): Promise<void> {
  await ensureLibraryShapes(["iso"]);
  const { container } = render(
    <svg>
      <MimicGlyph kind="tank" glyphSet="iso" level={0.64} x={0} y={0} size={60} className="stroke-info" />
    </svg>,
  );
  const fill = container.querySelector("[data-testid=mimic-tank-level]");
  expect(fill, "the iso tank draws its level").not.toBeNull();
  const box = ISO_LEVEL_BOXES["iso:tank"];
  expect(box).toBeDefined();
  expect(fill?.getAttribute("data-level")).toBe("64");
  expect(fill?.getAttribute("d")).toBe(isoTankLevelPath(box!, 0.64));
  expect(fill?.getAttribute("stroke")).toBe("none");
  expect(fill?.getAttribute("class")).toBe("fill-info/30");
  // Painted first, under the lines that cover its edge.
  expect(fill?.parentElement?.firstElementChild).toBe(fill);
}

/** GI3 — positive twin: with no glyph set the core tank draws the core level path, unchanged. */
export function aCoreTankKeepsTheCoreLevel(): void {
  const { container } = render(
    <svg>
      <MimicGlyph kind="tank" level={0.64} x={0} y={0} size={60} className="stroke-info" />
    </svg>,
  );
  expect(glyphOf(container).getAttribute("data-glyph")).toBe("tank");
  expect(container.querySelector("[data-testid=mimic-tank-level]")?.getAttribute("d")).toBe(tankFillPath(0.64));
}

/** GI4 — a library key and `alert` are unchanged under `iso`. */
export async function aKindWithoutATwinIsUnchangedUnderIso(): Promise<void> {
  await ensureLibraryShapes(["iso"]);
  const lib = render(
    <svg>
      <MimicGlyph kind="mdi:heat-pump" glyphSet="iso" x={0} y={0} size={60} className="stroke-info" />
    </svg>,
  );
  expect(glyphOf(lib.container).getAttribute("data-glyph")).toBe("mdi:heat-pump");
  const alert = render(
    <svg>
      <MimicGlyph kind="alert" glyphSet="iso" x={0} y={0} size={60} className="stroke-info" />
    </svg>,
  );
  expect(glyphOf(alert.container).getAttribute("data-glyph")).toBe("alert");
}

/** GI5 — `isoTankLevelPath` is exact: the back arc of the surface, the right side, the front arc
 * of the floor, closed. A swapped sweep flag or a lost `ry` reddens it. */
export function theIsoLevelPathIsExact(): void {
  const box = { cx: 12, rx: 5, ry: 2, top: 4, bottom: 20 };
  expect(isoTankLevelPath(box, 0.5)).toBe("M7 12A5 2 0 0 1 17 12L17 20A5 2 0 0 1 7 20Z");
  expect(isoTankLevelPath(box, 1)).toBe("M7 4A5 2 0 0 1 17 4L17 20A5 2 0 0 1 7 20Z");
  expect(isoTankLevelPath(box, 0)).toBe("M7 20A5 2 0 0 1 17 20L17 20A5 2 0 0 1 7 20Z");
}
