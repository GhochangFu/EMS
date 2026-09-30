/**
 * `F3.32f` / ADR 0086 decision 9 — what the generator and its source converters share: the
 * refusal type, the curation vocabulary, the label rule and the geometry grammar. Pure: importing
 * this module runs nothing, so `generate.mjs`, `sources/*.mjs` and the tests can all read it.
 *
 * The lists and expressions restate `packages/shared/src/contracts/mimic-shapes.ts` (the
 * generator runs without a build of `@bms/shared`). The transform block between the
 * `mimic-transform-grammar` markers is a verbatim copy of the one there, and
 * `tests/f3.32f-mimic-symbol-converters.test.ts` compares the two texts.
 */

/** A refusal: the generator stops at the first one, or `--report` collects them all. */
export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
  }
}

/** Refuses, naming what was refused. The caller decides whether to stop or to collect. */
export function fail(message) {
  throw new Refusal(message);
}

export const GROUPS = ["water", "electrical", "it_ups", "hvac", "mechanical", "environment", "facility", "general"];
export const TAGS = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
export const ATTRS = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "transform"];
export const ATTR_SET = new Set(ATTRS);

/** A curated name: what follows `<library>:` in a key. Checked before it reaches a path or a literal. */
export const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_KEY = 64;
/** `bms.mimic_symbols.label` is varchar(64). */
export const MAX_LABEL = 64;
export const MAX_SHAPES = 200;
/** A key the F3.32e colour scan would read as a colour, class or style attribute. */
export const COLOUR_WORD = /fill|stroke|style|class/i;

// The same three patterns as packages/shared/src/contracts/mimic-shapes.ts (unambiguous number).
export const NUMBER_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
export const PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9 ,.eE+\-]+$/;
export const POINTS_RE = /^[0-9 ,.eE+\-]+$/;
export const PATH_DATA_MAX = 8192;

// mimic-transform-grammar:begin — a verbatim copy of packages/shared/src/contracts/mimic-shapes.ts.
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

const UPPER = new Set(["ups", "hvac", "cpu", "ac", "dc", "co2", "ev", "lan", "pc", "it", "dg", "pdu", "led", "usb", "iot", "tv"]);

/** A curated name's label: words split on `-`, known acronyms upper-cased, the first letter capital. */
export function labelOf(name) {
  const words = name.split("-").map((w) => (UPPER.has(w) ? w.toUpperCase() : w));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Refuses a value outside its attribute's grammar; returns nothing when it passes. */
export function checkValue(key, attr, value) {
  const bad = (what) => fail(`${key} ${attr} ${JSON.stringify(value.slice(0, 80))} is ${what}`);
  if (attr === "transform") {
    if (!MIMIC_TRANSFORM_RE.test(value)) bad("outside the transform grammar");
  } else if (attr === "d") {
    if (value.length > PATH_DATA_MAX) bad(`longer than ${PATH_DATA_MAX}`);
    if (!PATH_DATA_RE.test(value)) bad("not path data");
  } else if (attr === "points") {
    if (value.length > PATH_DATA_MAX) bad(`longer than ${PATH_DATA_MAX}`);
    if (!POINTS_RE.test(value)) bad("not a points list");
  } else if (!NUMBER_RE.test(value)) {
    bad("not a number");
  }
}

/** Checks one symbol's nodes against the element and attribute lists and the value grammar;
 * returns them normalised (string values, React `key` dropped). `key` is `<library>:<name>`. */
export function checkNodes(key, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) fail(`${key} has no shape elements`);
  if (nodes.length > MAX_SHAPES) fail(`${key} has ${nodes.length} shape elements, more than ${MAX_SHAPES}`);
  return nodes.map(([tag, attrs]) => {
    if (!TAGS.has(tag)) fail(`${key} has element <${tag}>, outside the permitted list`);
    const clean = {};
    for (const [attr, raw] of Object.entries(attrs)) {
      if (attr === "key") continue; // Lucide's React key, not an SVG attribute
      if (!ATTR_SET.has(attr)) fail(`${key} has attribute ${attr}, outside the geometry list`);
      const value = String(raw);
      checkValue(key, attr, value);
      clean[attr] = value;
    }
    return [tag, clean];
  });
}
