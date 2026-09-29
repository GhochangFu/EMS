/**
 * `F3.32e` / ADR 0084 decision 5 — the shape elements a library glyph may draw, and the only
 * attributes they may carry: geometry. No colour, class, style, event handler or reference —
 * a glyph takes its colour from the role class on the wrapping `<g>` (decision 6). The generator
 * (`scripts/mimic-symbols/generate.mjs`) refuses anything outside these lists, and
 * `tests/f3.32e-mimic-symbol-libraries.test.ts` scans the generated modules for the same.
 */
export const MIMIC_SHAPE_TAGS = ["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"] as const;

export const MIMIC_SHAPE_ATTRS = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
] as const;

export type MimicShapeTag = (typeof MIMIC_SHAPE_TAGS)[number];
export type MimicShapeAttr = (typeof MIMIC_SHAPE_ATTRS)[number];

/** One element: its tag and its geometry attributes. */
export type MimicShape = readonly [MimicShapeTag, Readonly<Partial<Record<MimicShapeAttr, string>>>];
