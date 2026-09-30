import { z } from "zod";

/**
 * `F3.32f` / ADR 0086 decision 9 (amends ADR 0084 decision 5) — the shape elements a library
 * glyph may draw, and the only attributes they may carry: geometry, plus a `transform` in a
 * strict grammar. No colour, class, style, event handler or reference — a glyph takes its colour
 * from the role class on the wrapping `<g>` (ADR 0084 decision 6).
 *
 * The generator (`scripts/mimic-symbols/generate.mjs`, through `lib/grammar.mjs`) refuses anything
 * outside these lists; `tests/f3.32e-mimic-symbol-libraries.test.ts` reads the two lists from this
 * file's text, and `tests/f3.32f-mimic-symbol-converters.test.ts` compares the transform grammar
 * block below with the generator's copy, so the two cannot drift. The web renderer and slice 3's
 * upload path reuse `mimicShapeSchema`.
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
  "transform",
] as const;

/** The tag and attribute names as schemas, so their types are `z.infer`red (ADR 0030 decision 2). */
export const mimicShapeTagSchema = z.enum(MIMIC_SHAPE_TAGS);
export const mimicShapeAttrSchema = z.enum(MIMIC_SHAPE_ATTRS);

/**
 * One number: an optional sign, digits with an optional fraction, an optional exponent (`e` or
 * `E`, signed). Unambiguous on purpose — a digit run has exactly one way to match, so a failing
 * test is linear. The earlier `\d+\.?\d*` could split a run n ways and cost O(n²) on the upload
 * path (26.8 s on a 64 KiB attribute).
 */
export const MIMIC_NUMBER_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/** SVG path data: the command letters, digits, spaces, commas, points, signs and exponents. */
export const MIMIC_PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9 ,.eE+\-]+$/;

/** A `points` list: digits, spaces, commas, points, signs and exponents. */
export const MIMIC_POINTS_RE = /^[0-9 ,.eE+\-]+$/;

export const MIMIC_PATH_DATA_MAX = 8192;

// mimic-transform-grammar:begin — copied verbatim into scripts/mimic-symbols/lib/grammar.mjs.
const TRANSFORM_NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const TRANSFORM_SEP = "[, ]";
const TRANSFORM_FN = [
  String.raw`matrix\(${TRANSFORM_NUM}(?:${TRANSFORM_SEP}${TRANSFORM_NUM}){5}\)`,
  String.raw`translate\(${TRANSFORM_NUM}(?:${TRANSFORM_SEP}${TRANSFORM_NUM})?\)`,
  String.raw`scale\(${TRANSFORM_NUM}(?:${TRANSFORM_SEP}${TRANSFORM_NUM})?\)`,
  String.raw`rotate\(${TRANSFORM_NUM}(?:${TRANSFORM_SEP}${TRANSFORM_NUM}${TRANSFORM_SEP}${TRANSFORM_NUM})?\)`,
  String.raw`skewX\(${TRANSFORM_NUM}\)`,
  String.raw`skewY\(${TRANSFORM_NUM}\)`,
].join("|");
/**
 * An SVG transform list of numbers only: `matrix` (6), `translate` and `scale` (1–2), `rotate`
 * (1 or 3), `skewX` and `skewY` (1); numbers separated by exactly one comma or one space,
 * functions by exactly one space, at most 256 characters, no leading or trailing space.
 */
export const MIMIC_TRANSFORM_RE = new RegExp(`^(?=.{1,256}$)(?:${TRANSFORM_FN})(?: (?:${TRANSFORM_FN}))*$`);
// mimic-transform-grammar:end

const number = z.string().regex(MIMIC_NUMBER_RE).optional();

/** One element: its tag and its geometry attributes, every one optional and bounded. */
export const mimicShapeSchema = z
  .tuple([
    mimicShapeTagSchema,
    z
      .object({
        d: z.string().max(MIMIC_PATH_DATA_MAX).regex(MIMIC_PATH_DATA_RE).optional(),
        cx: number,
        cy: number,
        r: number,
        rx: number,
        ry: number,
        x: number,
        y: number,
        width: number,
        height: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        points: z.string().max(MIMIC_PATH_DATA_MAX).regex(MIMIC_POINTS_RE).optional(),
        transform: z.string().max(256).regex(MIMIC_TRANSFORM_RE).optional(),
      })
      .strict()
      .readonly(),
  ])
  .readonly();
