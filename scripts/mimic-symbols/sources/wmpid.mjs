/**
 * `F3.32f` / ADR 0086 decision 9 — the Wikimedia Commons P&ID source (`wmpid`): the public-domain
 * and CC0 files of `Category:P&ID symbols`. Commons has no release, so each curated file is pinned
 * by its `sha1` and `timestamp`. `wmpid-curate.mjs` lists the candidates; `fetch-sources.mjs wmpid
 * --out <dir>` downloads the curated files (and refuses a file whose bytes differ);
 * `generate.mjs --wmpid <dir>` reads them, and `shapes(entry)` checks the pin again.
 *
 * Curation (`curation/wmpid.json`): `{ "<group>": [{ "name": "<slug>", "title": "File:….svg",
 * "url": "https://upload.wikimedia.org/…", "sha1": "…", "timestamp": "…Z", "author": "…",
 * "licence": "Public domain" | "CC0", "templates": ["PD-self"] }] }`.
 *
 * `convertSvg(svgText)` (plan D6) walks the document depth first. The transforms of the `svg` and
 * `g` chain, the shape's own transform and the fit of the root box into 24 × 24 compose into one
 * matrix per shape. Without a rotation or skew the matrix is baked into the shape's coordinates;
 * otherwise the shape keeps its source coordinates and carries `transform="matrix(…)"` (ADR 0086,
 * "`transform` joins the attribute list"). A shape that draws nothing visible (`display:none`, or
 * no stroke and a white or no fill, read from `style` and the presentation attributes, inherited
 * through the groups) is dropped. Metadata elements are skipped. An element that draws text, an
 * image, a `<use>` reference, a paint server, a clip, a mask, a filter or a style sheet is refused,
 * naming it, and so is a `clip-path`, `mask` or `filter` property — the curator removes that file
 * from the list; a source file is never patched. A `marker-*` property is NOT refused: its
 * `<marker>` sits in `defs`, which is never drawn, so the arrowhead is dropped and the line kept
 * (four curated files lose one: settling-chamber, cyclone-separator, wet-scrubber,
 * valve-control-continuous; refusing them would change migration 0092's keys).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bakeShape, identity, isBakeable, multiply, normaliseTo24, parseTransformList } from "../lib/geometry.mjs";
import { Refusal, TAGS, fail } from "../lib/grammar.mjs";
import { parseXml } from "../lib/xml.mjs";

const PINNED = "2026-09-29";
const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";
const COMMONS_WIKI = "https://commons.wikimedia.org/wiki/";

/** Elements that carry no drawing: skipped with their subtree. */
const SKIPPED = new Set(["defs", "metadata", "title", "desc"]);
/** Namespaced editor elements (`sodipodi:namedview`, `inkscape:grid`, `rdf:RDF`): skipped too. */
const SKIPPED_PREFIX = /^(?:sodipodi|inkscape|rdf|cc|dc):/;
/** Elements that draw text or an image, reference, paint, clip or style another element: refused. */
const REFUSED = new Set([
  "text",
  "tspan",
  "textPath",
  "flowRoot",
  "use",
  "image",
  "style",
  "script",
  "linearGradient",
  "radialGradient",
  "pattern",
  "clipPath",
  "mask",
  "filter",
  "marker",
  "symbol",
  "a",
  "switch",
  "foreignObject",
]);
/** Inside `defs` only these are refused: the rest of `defs` is never drawn. */
const REFUSED_IN_DEFS = new Set(["style", "script"]);
/** Attributes and style properties that clip, mask or filter what they sit on. */
const REFERENCING = ["clip-path", "mask", "filter"];
const WHITE_OR_NONE = new Set(["none", "transparent", "white", "#fff", "#ffffff", "rgb(255,255,255)"]);
const THRESHOLD_TEMPLATES = ["PD-shape", "PD-textlogo", "PD-ineligible"];

/** Totals over every converted shape, printed once when generation ends. */
const stats = { baked: 0, transformed: 0 };

/** A number with at most `decimals` decimals, no exponent, no `-0`; it matches the transform grammar. */
function formatTo(n, decimals) {
  if (!Number.isFinite(n)) throw new Error(`matrix value ${n} is not finite`);
  const scale = 10 ** decimals;
  const r = Math.round(n * scale) / scale;
  if (r === 0) return "0";
  const text = r.toFixed(decimals).replace(/\.?0+$/, "");
  if (/e/i.test(text)) throw new Error(`matrix value ${n} is out of range`);
  return text;
}

/**
 * A matrix as `matrix(a,b,c,d,e,f)`: the linear part to 5 decimals (a scale of 0.034 written to
 * 3 decimals would be 1 % out), the translation to 3 — both inside the grammar's number form.
 */
function matrixText(m) {
  return `matrix(${m.map((v, i) => formatTo(v, i < 4 ? 5 : 3)).join(",")})`;
}

/** Rounding noise from `rotate(180)` and the like (`sin π ≈ 1e-16`) is read as zero. */
const snap = (m) => m.map((v) => (Math.abs(v) < 1e-12 ? 0 : v));

/** `style="a:b;c:d"` as a map, keys lower-cased, values trimmed and lower-cased. */
function styleOf(attrs) {
  const out = {};
  for (const part of String(attrs.style ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim().toLowerCase();
  }
  return out;
}

/** The paint state of an element: its `style` wins over its presentation attributes, which win
 * over the parent's inherited paint. `display:none` and `visibility:hidden` hide the subtree. */
function paintOf(attrs, parent) {
  const style = styleOf(attrs);
  const read = (name) => style[name] ?? (attrs[name] !== undefined ? String(attrs[name]).trim().toLowerCase() : undefined);
  const fillOpacity = read("fill-opacity");
  const strokeOpacity = read("stroke-opacity");
  const strokeWidth = read("stroke-width");
  return {
    hidden: parent.hidden || read("display") === "none" || read("visibility") === "hidden" || read("opacity") === "0",
    fill: fillOpacity !== undefined && Number(fillOpacity) === 0 ? "none" : (read("fill") ?? parent.fill),
    stroke:
      (strokeOpacity !== undefined && Number(strokeOpacity) === 0) || (strokeWidth !== undefined && parseFloat(strokeWidth) === 0)
        ? "none"
        : (read("stroke") ?? parent.stroke),
  };
}

/** Nothing visible: hidden, or no stroke over a white or empty fill. */
const invisible = (paint) => paint.hidden || (paint.stroke === "none" && WHITE_OR_NONE.has(paint.fill.replace(/\s+/g, "")));

/** Refuses an element that clips, masks or filters, by attribute or by style. */
function refuseReferencing(name, attrs) {
  const style = styleOf(attrs);
  for (const prop of REFERENCING) {
    const value = style[prop] ?? attrs[prop];
    if (value !== undefined && String(value).trim().toLowerCase() !== "none") fail(`wmpid: <${name}> carries ${prop}, which is refused`);
  }
}

const UNIT = /^\s*(\d+\.?\d*|\.\d+)(px|pt|mm)?\s*$/;

/** CSS pixels per unit: a root without a viewBox draws in user units of one CSS px (SVG 1.1 §7.2). */
const PX_PER = { px: 1, pt: 4 / 3, mm: 96 / 25.4 };

/**
 * The root's box: its viewBox, else its width and height converted to px — the user units its
 * content is drawn in when there is no viewBox (`16mm` is a 60.47-unit box, not a 16-unit one).
 */
function boxOf(root) {
  if (root.attrs.viewBox !== undefined) {
    const v = String(root.attrs.viewBox).trim().split(/[\s,]+/).map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || !(v[2] > 0) || !(v[3] > 0)) {
      fail(`wmpid: viewBox ${JSON.stringify(root.attrs.viewBox)} is not a box`);
    }
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  }
  const w = UNIT.exec(String(root.attrs.width ?? ""));
  const h = UNIT.exec(String(root.attrs.height ?? ""));
  if (!w || !h || !(Number(w[1]) > 0) || !(Number(h[1]) > 0)) fail("wmpid: the root has no viewBox and no width and height in px, pt or mm");
  const px = (m) => Number(m[1]) * PX_PER[m[2] ?? "px"];
  return { x: 0, y: 0, w: px(w), h: px(h) };
}

/** The element name without an `svg:` prefix (some Inkscape files write `svg:path`). */
const local = (name) => name.replace(/^svg:/, "");

/** Only the geometry attributes a shape needs; the rest (ids, styles, editor data) is left behind. */
const GEOMETRY = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"];
function geometryOf(attrs) {
  const out = {};
  for (const name of GEOMETRY) if (attrs[name] !== undefined) out[name] = attrs[name];
  return out;
}

/** One shape under the composed matrix `m` (the chain times the fit; its own transform not yet in). */
function convertShape(tag, attrs, m) {
  const own = attrs.transform !== undefined ? parseTransformList(attrs.transform) : identity();
  const whole = snap(multiply(m, own));
  const geometry = geometryOf(attrs);
  if (isBakeable(whole)) {
    try {
      const baked = bakeShape([tag, geometry], whole);
      stats.baked += 1;
      return baked;
    } catch (error) {
      // A rotated arc under a non-uniform scale cannot be baked; it keeps a transform below.
      if (!/not bakeable/.test(error.message)) throw error;
    }
  }
  const [outTag, outAttrs] = bakeShape([tag, geometry], identity());
  stats.transformed += 1;
  return [outTag, { ...outAttrs, transform: matrixText(whole) }];
}

/** One Commons SVG document as its shape list in the 24-unit box. Pure but for the totals. */
export function convertSvg(svgText) {
  const root = parseXml(svgText);
  if (local(root.name) !== "svg") fail(`wmpid: the root is <${root.name}>, not <svg>`);
  if (root.attrs.transform !== undefined) fail("wmpid: a transform on the root <svg> is refused");
  const fit = normaliseTo24(boxOf(root));
  const shapes = [];
  const walk = (node, chain, paint, inDefs) => {
    for (const child of node.children) {
      const name = local(child.name);
      if (inDefs) {
        if (REFUSED_IN_DEFS.has(name)) fail(`wmpid: <${name}> is refused`);
        walk(child, chain, paint, true);
        continue;
      }
      if (name === "defs") {
        walk(child, chain, paint, true);
        continue;
      }
      if (SKIPPED.has(name) || SKIPPED_PREFIX.test(child.name)) continue;
      if (REFUSED.has(name)) fail(`wmpid: <${name}> is refused`);
      refuseReferencing(name, child.attrs);
      const childPaint = paintOf(child.attrs, paint);
      if (name === "g") {
        const own = child.attrs.transform !== undefined ? parseTransformList(child.attrs.transform) : identity();
        walk(child, multiply(chain, own), childPaint, false);
        continue;
      }
      if (!TAGS.has(name)) fail(`wmpid: <${name}> is refused`);
      if (child.children.length > 0 && child.children.some((c) => !SKIPPED.has(local(c.name)))) {
        fail(`wmpid: <${name}> has child elements`);
      }
      if (invisible(childPaint)) continue;
      shapes.push(convertShape(name, child.attrs, multiply(fit, chain)));
    }
  };
  const rootPaint = paintOf(root.attrs, { hidden: false, fill: "#000000", stroke: "none" });
  walk(root, identity(), rootPaint, false);
  return shapes;
}

/** True when `bytes` hash to `sha1` (lower-case hex), the Commons pin. */
export function verifyPin(bytes, sha1) {
  return createHash("sha1").update(bytes).digest("hex") === String(sha1).toLowerCase();
}

/** The first of `templates` that names a threshold-of-originality template, if any. */
const thresholdOf = (templates) =>
  templates.find((t) => THRESHOLD_TEMPLATES.some((name) => name.toLowerCase() === String(t).toLowerCase()));

/**
 * A file's licence as the attributions page shows it: `CC0 1.0 Universal`, or `Public domain`
 * with its template — `(threshold of originality)` after `PD-shape`, `PD-textlogo` and
 * `PD-ineligible`. Any other licence is refused: share-alike and GPL files stay out (decision 9).
 */
export function classifyLicence({ licence, templates = [] }) {
  const list = Array.isArray(templates) ? templates.map(String) : [];
  if (licence === "CC0") return "CC0 1.0 Universal";
  if (licence !== "Public domain") return fail(`wmpid: licence ${JSON.stringify(licence)} is not public domain or CC0`);
  const threshold = thresholdOf(list);
  if (threshold) return `Public domain — ${threshold} (threshold of originality)`;
  const pd = list.find((t) => /^PD-/i.test(t));
  return pd ? `Public domain — ${pd}` : "Public domain";
}

/** The licence page a credit links: the CC0 deed, or the Commons page of the file's PD template. */
function licenceUrlOf(entry) {
  if (entry.licence === "CC0") return CC0_URL;
  const list = (entry.templates ?? []).map(String);
  const template = thresholdOf(list) ?? list.find((t) => /^PD-/i.test(t));
  return template ? `${COMMONS_WIKI}Template:${encodeURIComponent(template)}` : `${COMMONS_WIKI}Commons:Copyright_tags`;
}

const LICENCE =
  "Public-domain and CC0 1.0 files from Wikimedia Commons, Category:P&ID symbols, fetched on 2026-09-29; " +
  "each file is pinned by its Commons sha1 and revision timestamp and the generator refuses a file whose bytes differ. " +
  "Files under a threshold-of-originality template (PD-shape, PD-textlogo, PD-ineligible) are labelled as such. " +
  "Public domain asks for no attribution; authors are credited on the attributions page. " +
  "CC0: https://creativecommons.org/publicdomain/zero/1.0/";

const CONVERSION =
  "Converted by scripts/mimic-symbols/generate.mjs from the SVG files of Wikimedia Commons Category:P&ID symbols " +
  "(fetched on 2026-09-29) into shape arrays of their geometry: each shape's group transforms are composed and taken " +
  "into its coordinates, or kept as one transform when they rotate or skew; colours, line-end markers and invisible " +
  "shapes are dropped; " +
  "the drawings are otherwise unchanged.";

/** Each credit row's note of how the file was changed (ADR 0086 decision 9). */
const ADAPTATION =
  "Adapted: converted to geometry, fitted to a 24-unit box with its group transforms composed; colours, markers and invisible shapes removed.";

let reported = false;

function load(dir) {
  if (!reported) {
    reported = true;
    process.once("exit", () => {
      console.log(`generate: wmpid shapes — ${stats.baked} baked, ${stats.transformed} carrying a transform`);
    });
  }
  return {
    version: PINNED,
    licence: LICENCE,
    conversion: CONVERSION,
    shapes(entry) {
      const key = `wmpid:${entry.name}`;
      if (typeof entry.sha1 !== "string" || !/^[0-9a-f]{40}$/.test(entry.sha1)) fail(`${key} has no sha1 pin`);
      const bytes = readFileSync(join(dir, `${entry.name}.svg`));
      if (!verifyPin(bytes, entry.sha1)) fail(`${key} (${entry.title}): the file's sha1 differs from the pin ${entry.sha1}`);
      try {
        return convertSvg(bytes.toString("utf8"));
      } catch (error) {
        throw new Refusal(`${key} (${entry.title}): ${error.message}`);
      }
    },
    credit(entry) {
      const title = String(entry.title ?? "");
      if (!/^File:.+\.svg$/i.test(title)) fail(`wmpid:${entry.name} title ${JSON.stringify(title)} is not a File: SVG`);
      if (typeof entry.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T[0-9:]+Z$/.test(entry.timestamp)) {
        fail(`wmpid:${entry.name} has no timestamp pin`);
      }
      // An empty author is refused, never printed as "unknown": the curator records the uploader
      // who placed the PD-self template, from the file page history.
      const author = String(entry.author ?? "").trim();
      if (author === "") fail(`wmpid:${entry.name} (${title}) has no author in the curation`);
      return {
        author,
        source: COMMONS_WIKI + encodeURI(title),
        licence: classifyLicence(entry),
        licenceUrl: licenceUrlOf(entry),
        pin: `${entry.sha1}@${entry.timestamp}`,
        adaptation: ADAPTATION,
      };
    },
  };
}

export const LIBRARY = {
  code: "wmpid",
  constant: "WMPID",
  type: "WmpidSymbolKey",
  label: "Wikimedia Commons P&ID",
  source: "Wikimedia Commons Category:P&ID symbols",
  pinned: PINNED,
  licenceName: "Public domain / CC0",
  attributionUrl: "https://commons.wikimedia.org/wiki/Category:P%26ID_symbols",
  style: "stroke",
  entryShape: "object",
  load,
};
