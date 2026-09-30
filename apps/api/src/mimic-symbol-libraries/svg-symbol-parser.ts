import { SaxesParser } from "saxes";
import type { SaxesTagPlain } from "saxes";

import {
  MAX_MIMIC_SYMBOL_PATH_CHARS,
  MAX_MIMIC_SYMBOL_SHAPES,
  MIMIC_NUMBER_RE,
  MIMIC_PATH_DATA_RE,
  MIMIC_POINTS_RE,
  MIMIC_SHAPE_ATTRS,
  MIMIC_SHAPE_TAGS,
  MIMIC_TRANSFORM_RE,
  mimicShapeSchema,
  mimicViewBoxSchema,
} from "@bms/shared";
import type { MimicShape } from "@bms/shared";

/**
 * `F3.32f` slice 3 / ADR 0086 decision 6 (plan D7) — an uploaded SVG file becomes **geometry
 * only**: a `viewBox` tuple and a list of `[tag, attrs]` shapes in the stored grammar. Nothing of
 * the file's text is kept; there is no sanitizer that rewrites markup, because nothing is served
 * as markup. Pure — no Nest import — so the spec drives it directly.
 *
 * **The walker is `saxes`** with no `xmlns` option, so a tag name keeps its prefix
 * (`sodipodi:namedview`) and the attributes are a plain record. Measured on saxes 6.0.0, not
 * assumed: saxes resolves only the five XML entities and reports any other — `&xxe;` — as an
 * `error` event, then carries on with the raw text; it does not throw unless no `error` handler
 * is attached. So the `error` handler below throws, and an undefined entity, a stray `&`, an
 * unclosed tag and a second root all refuse as "not well-formed". No pre-scan of the text is
 * needed. The XML declaration is the `xmldecl` event and is permitted; any other processing
 * instruction, a DOCTYPE (with or without an internal subset) and a CDATA section refuse.
 *
 * **Refusals** (`SvgSymbolRefusal`, shown to the caller as a 400): an element outside the seven
 * shape tags, `g`, `defs` and the dropped editor elements — `script`, `style`, `use`, `image`,
 * `foreignObject`, `a`, `text`, a gradient, a pattern, `filter`, `mask`, `clipPath`, `symbol`,
 * `switch`, a nested `svg`, anything unknown; a `defs` with an element child; non-whitespace
 * text; a root other than `svg`; a `viewBox` that is not four numbers with a positive size; a
 * kept attribute outside its grammar (a number with a unit, path data with a letter outside
 * the command set or over 8192 characters, a transform with `url(`); more than 200 shapes; no
 * shape at all. **A message names the element and the attribute, never a value**: the tag name
 * is capped at 32 characters with `[^a-zA-Z0-9:_-]` stripped, so no content reaches it.
 *
 * **Drops** (never stored, never refused): every attribute outside `MIMIC_SHAPE_ATTRS`
 * (`onload`, `style`, `fill`, `stroke`, `class`, `href`, `xlink:href`, `id`, editor namespaces);
 * `title`, `desc`, `metadata`, `sodipodi:*` and `inkscape:*` elements with their whole
 * subtrees (Inkscape's `metadata` holds `rdf:RDF`, `cc:Work`, `dc:*` — none reach the refusal;
 * a `script`, `style`, `foreignObject` or `image` inside one still refuses, decision 6);
 * an empty `defs`. Root attributes other than `viewBox` are ignored: `width="210mm"` is normal.
 *
 * **Geometry.** A `g`'s `transform` is pushed down onto every shape inside it, outermost first
 * and the shape's own last — SVG's list order — and the `g` itself is not stored. Whitespace in
 * `d`, `points` and `transform` is normalised into the stored grammar (Inkscape wraps path data
 * over lines); the grammar itself is the shared one (`contracts/mimic-shapes.ts`), and every
 * emitted shape and the view box are re-checked by `mimicShapeSchema` / `mimicViewBoxSchema`
 * with `safeParse`, so an upload can never store a row the read path would then omit.
 */

export class SvgSymbolRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SvgSymbolRefusal";
  }
}

export type ParsedSvgSymbol = {
  viewBox: [number, number, number, number];
  shapes: MimicShape[];
};

/** The attributes a stored shape may carry — the shared allowlist, iterated in its order. */
const KEPT_ATTRS: readonly string[] = MIMIC_SHAPE_ATTRS;

const SHAPE_TAGS: ReadonlySet<string> = new Set(MIMIC_SHAPE_TAGS);

/** Editor metadata, dropped with its whole subtree. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set(["title", "desc", "metadata"]);
const DROPPED_PREFIXES = ["sodipodi:", "inkscape:"] as const;
/** Elements that refuse the file at any depth, inside a dropped subtree too (decision 6). */
const REFUSED_IN_DROPPED: ReadonlySet<string> = new Set(["script", "style", "foreignObject", "image"]);

/** A tag name as a message may show it: 32 characters at most, no punctuation beyond `:_-`. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 32);
}

const refuse = (reason: string): never => {
  throw new SvgSymbolRefusal(reason);
};

const notAllowed = (name: string): never => refuse(`Element <${safeName(name)}> is not allowed in a symbol`);

function isDropped(name: string): boolean {
  return DROPPED_ELEMENTS.has(name) || DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Collapses whitespace runs to one space and trims; SVG treats them alike. */
const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** A transform list into the stored grammar's spacing: `fn(a,b) fn(c)`. */
function normaliseTransform(value: string): string {
  return collapse(value)
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*,\s*/g, ",")
    .replace(/\)\s*(?=\S)/g, ") ");
}

/** One kept attribute's value in the stored grammar, or `null` when it is outside it. */
function inGrammar(attr: string, raw: string): string | null {
  switch (attr) {
    case "d": {
      const value = collapse(raw);
      return value.length <= MAX_MIMIC_SYMBOL_PATH_CHARS && MIMIC_PATH_DATA_RE.test(value) ? value : null;
    }
    case "points": {
      const value = collapse(raw);
      return value.length <= MAX_MIMIC_SYMBOL_PATH_CHARS && MIMIC_POINTS_RE.test(value) ? value : null;
    }
    case "transform": {
      if (raw.length > MAX_MIMIC_SYMBOL_PATH_CHARS) return null;
      const value = normaliseTransform(raw);
      return value.length <= MAX_TRANSFORM_CHARS && MIMIC_TRANSFORM_RE.test(value) ? value : null;
    }
    default: {
      const value = raw.trim();
      return value.length <= MAX_NUMBER_CHARS && MIMIC_NUMBER_RE.test(value) ? value : null;
    }
  }
}

/**
 * Length caps checked before any grammar regex runs, as `d` and `points` already are: the
 * regexes are linear, and the cap keeps them so if one ever regresses (review blocker, ReDoS).
 */
const MAX_NUMBER_CHARS = 32;
const MAX_TRANSFORM_CHARS = 256;

function readViewBox(raw: string | undefined): [number, number, number, number] {
  const parts = raw === undefined ? [] : raw.trim().split(/[\s,]+/);
  const refusal = "Element <svg> needs a viewBox of four numbers";
  if (parts.length !== 4 || !parts.every((part) => part.length <= MAX_NUMBER_CHARS && MIMIC_NUMBER_RE.test(part))) {
    refuse(refusal);
  }
  const parsed = mimicViewBoxSchema.safeParse(parts.map(Number));
  return parsed.success ? parsed.data : refuse(refusal);
}

type Frame = {
  readonly name: string;
  /** The `g`'s own validated transform; `null` on any other element or a `g` without one. */
  readonly transform: string | null;
};

/** An uploaded SVG file's view box and shapes in the stored grammar; refuses with `SvgSymbolRefusal`. */
export function parseSvgSymbol(buffer: Buffer): ParsedSvgSymbol {
  const parser = new SaxesParser();
  const stack: Frame[] = [];
  /** Stack depth at which a dropped subtree began; everything deeper is ignored. */
  let droppedAt: number | null = null;
  let viewBox: [number, number, number, number] | null = null;
  const shapes: MimicShape[] = [];

  parser.on("error", () => refuse("The file is not well-formed XML"));
  parser.on("doctype", () => refuse("A DOCTYPE is not allowed in a symbol"));
  parser.on("processinginstruction", () => refuse("A processing instruction is not allowed in a symbol"));
  parser.on("cdata", () => refuse("A CDATA section is not allowed in a symbol"));
  parser.on("text", (text) => {
    if (droppedAt === null && text.trim() !== "") refuse("Text content is not allowed in a symbol");
  });

  parser.on("opentag", (tag: SaxesTagPlain) => {
    const { name } = tag;
    const attributes = tag.attributes as Record<string, string>;
    const parent = stack.at(-1);
    if (droppedAt !== null) {
      // ADR 0086 decision 6: a `script` or `style` still refuses the file, even inside metadata.
      if (REFUSED_IN_DROPPED.has(name.slice(name.lastIndexOf(":") + 1))) notAllowed(name);
      stack.push({ name, transform: null });
      return;
    }
    if (parent === undefined) {
      if (name !== "svg") refuse(`The root element <${safeName(name)}> is not svg`);
      viewBox = readViewBox(attributes.viewBox);
      stack.push({ name, transform: null });
      return;
    }
    if (isDropped(name)) {
      droppedAt = stack.length;
      stack.push({ name, transform: null });
      return;
    }
    if (parent.name === "defs") {
      refuse(`Element <${safeName(name)}> inside <defs> is not allowed in a symbol`);
    }
    if (SHAPE_TAGS.has(parent.name)) {
      refuse(`Element <${safeName(name)}> inside <${parent.name}> is not allowed in a symbol`);
    }
    if (name === "defs") {
      stack.push({ name, transform: null });
      return;
    }
    if (name === "g") {
      stack.push({ name, transform: keptValue(name, "transform", attributes.transform) });
      return;
    }
    if (!SHAPE_TAGS.has(name)) notAllowed(name);

    const attrs: Record<string, string> = {};
    for (const attr of KEPT_ATTRS) {
      const raw = attributes[attr];
      if (raw === undefined || attr === "transform") continue;
      attrs[attr] = keptValue(name, attr, raw) as string;
    }
    const own = keptValue(name, "transform", attributes.transform);
    const transforms = [...stack.map((frame) => frame.transform), own].filter((t): t is string => t !== null);
    if (transforms.length > 0) attrs.transform = transforms.join(" ");

    const shape = mimicShapeSchema.safeParse([name, attrs]);
    if (!shape.success) refuse(`Element <${name}> is not in the shape grammar`);
    if (shapes.length >= MAX_MIMIC_SYMBOL_SHAPES) refuse(`A symbol holds at most ${MAX_MIMIC_SYMBOL_SHAPES} shapes`);
    shapes.push([name, attrs] as MimicShape);
    stack.push({ name, transform: null });
  });

  parser.on("closetag", () => {
    stack.pop();
    if (droppedAt !== null && stack.length <= droppedAt) droppedAt = null;
  });

  const text = buffer.toString("utf8").replace(/^﻿/, "");
  try {
    parser.write(text).close();
  } catch (err) {
    if (err instanceof SvgSymbolRefusal) throw err;
    refuse("The file is not well-formed XML");
  }
  if (viewBox === null || shapes.length === 0) refuse("The file draws nothing");
  return { viewBox: viewBox as unknown as [number, number, number, number], shapes };
}

/** A kept attribute's value in the grammar, `null` when absent; outside the grammar refuses. */
function keptValue(element: string, attr: string, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  return inGrammar(attr, raw) ?? refuse(`Attribute ${attr} of <${safeName(element)}> is not in the shape grammar`);
}
