/**
 * `F3.32f` / ADR 0086 decision 9 — the draw.io stencils source (`drawio`): the `pid` and
 * `electrical` stencil sets at `jgraph/drawio@48b181339578e11da7052ebf5b1fba8499418b77`
 * (v29.3.2, CC BY 4.0 per the owner's ruling of 2026-09-29). Every vendor set is excluded. The
 * files are fetched by `fetch-sources.mjs drawio --out <dir>`; `generate.mjs --drawio <dir>` reads
 * them: `<dir>/README.md`, `<dir>/stencils/LICENSE` (when present) and `<dir>/stencils/<set>.xml`.
 *
 * Curation (`curation/drawio.json`): `{ "<group>": [{ "name": "<slug>", "set": "pid/pumps",
 * "shape": "Centrifugal Pump 1" }] }`.
 *
 * - `LIBRARY.load(dir)` → `{ version, licence, conversion, shapes(entry), credit(entry) }`, as in
 *   `sources/qet.mjs`. `licence` quotes the README's License section at the pin, which must grant
 *   the icons `licensed under the CC BY 4.0` (plan D8): the owner's ruling rests on that sentence,
 *   so `load` refuses without it.
 * - `convertStencil(shapeElement)` — pure: one `<shape>` element of a stencil set, as parsed by
 *   `lib/xml.mjs`, to `[tag, attrs][]` in the 24-unit box. The primitives follow `mxStencil.js`
 *   at the pin: `path` (`move`, `line`, `quad`, `curve`, `arc`, `close`) becomes one `path`,
 *   `rect` a `rect`, `roundrect` a `rect` with `rx = ry = min(w, h) · arcsize / 100` (default 15),
 *   `ellipse` an `ellipse`. Paint, state, text and connection elements are dropped; `image`,
 *   `include-shape` and any element `mxStencil.js` does not know are refused.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { apply, format, normaliseTo24 } from "../lib/geometry.mjs";
import { fail } from "../lib/grammar.mjs";
import { parseXml } from "../lib/xml.mjs";

export const DRAWIO_PIN = "48b181339578e11da7052ebf5b1fba8499418b77";
const VERSION = "29.3.2";
const PIN_DATE = "2026-01-17";
const AUTHOR = "JGraph Ltd, draw.io";
const LICENCE = "CC BY 4.0";
/** Each credit row's note that the symbol is modified (CC BY 4.0 §3(a)(1)(B), ADR 0086 decision 9). */
const ADAPTATION = "Adapted: converted to geometry, fitted to a 24-unit box; text, colour and connection points removed.";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
/** A set in the two ruled-in families, as `fetch-sources.mjs` accepts it; no `.` and no `..`. */
const SET = /^(?:pid|electrical)\/[A-Za-z0-9_-]+$/;
const GRANT = "licensed under the CC BY 4.0";
/** mxConstants.RECTANGLE_ROUNDING_FACTOR × 100, the arcsize `mxStencil.js` takes when none is given. */
const DEFAULT_ARCSIZE = 15;

/** Paint and canvas-state elements: they colour or restyle, and draw nothing. */
const PAINT = new Set([
  "fillstroke",
  "stroke",
  "fill",
  "fillcolor",
  "strokecolor",
  "strokewidth",
  "dashed",
  "dashpattern",
  "linejoin",
  "linecap",
  "miterlimit",
  "alpha",
  "fillalpha",
  "strokealpha",
  "save",
  "restore",
]);
/** Text and its font state: a symbol carries no words. */
const TEXT = new Set(["text", "fontsize", "fontcolor", "fontstyle", "fontfamily"]);

/** Markdown links `[label](url)` read as their label. */
const flattenLinks = (text) => String(text).replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1");

/** Whether a README grants the CC BY 4.0 sentence the owner relied on; a markdown link reads as its label. */
export function readmeGrantsCcBy(text) {
  return flattenLinks(text).replace(/\s+/g, " ").includes(GRANT);
}

const number = (where, node, attr, fallback) => {
  const raw = node.attrs[attr];
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    return fail(`${where}: <${node.name}> has no ${attr}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`${where}: <${node.name}> ${attr} ${JSON.stringify(raw)} is not a number`);
  return n;
};

const flag = (where, node, attr) => {
  const n = number(where, node, attr);
  if (n !== 0 && n !== 1) fail(`${where}: <${node.name}> ${attr} ${n} is not 0 or 1`);
  return n;
};

/** One `<path>` as SVG path data with `m` baked into every point; `null` when it draws nothing. */
function pathData(where, path, m) {
  const s = m[0];
  const pt = (node, x, y) => apply(m, number(where, node, x), number(where, node, y)).map(format).join(" ");
  const parts = [];
  for (const node of path.children) {
    switch (node.name) {
      case "move":
        parts.push(`M${pt(node, "x", "y")}`);
        break;
      case "line":
        parts.push(`L${pt(node, "x", "y")}`);
        break;
      case "quad":
        parts.push(`Q${pt(node, "x1", "y1")} ${pt(node, "x2", "y2")}`);
        break;
      case "curve":
        parts.push(`C${pt(node, "x1", "y1")} ${pt(node, "x2", "y2")} ${pt(node, "x3", "y3")}`);
        break;
      case "arc": {
        const rx = format(number(where, node, "rx") * s);
        const ry = format(number(where, node, "ry") * s);
        const rotation = format(number(where, node, "x-axis-rotation", 0));
        const large = flag(where, node, "large-arc-flag");
        const sweep = flag(where, node, "sweep-flag");
        parts.push(`A${rx} ${ry} ${rotation} ${large} ${sweep} ${pt(node, "x", "y")}`);
        break;
      }
      case "close":
        parts.push("Z");
        break;
      default:
        fail(`${where}: <${node.name}> inside <path> is refused`);
    }
  }
  if (parts.length === 0) return null;
  if (!parts[0].startsWith("M")) fail(`${where}: a <path> does not begin with <move>`);
  return parts.join(" ");
}

/** One drawing element of a `<background>` or `<foreground>`, appended to `out`. */
function drawElement(where, node, m, out) {
  const s = m[0];
  // mxStencil.js reads an absent attribute as Number(null) = 0, so a bare <rect/> has no size and
  // draws nothing; `box()` answers null for it.
  const box = () => {
    const x = number(where, node, "x", 0);
    const y = number(where, node, "y", 0);
    const w = number(where, node, "w", 0);
    const h = number(where, node, "h", 0);
    if (w === 0 || h === 0) return null;
    if (w < 0 || h < 0) fail(`${where}: <${node.name}> has a negative size ${w}×${h}`);
    const [x1, y1] = apply(m, x, y);
    return { x: x1, y: y1, w: w * s, h: h * s, rawW: w, rawH: h };
  };
  if (PAINT.has(node.name) || TEXT.has(node.name)) return;
  switch (node.name) {
    case "path": {
      const d = pathData(where, node, m);
      if (d !== null) out.push(["path", { d }]);
      return;
    }
    case "rect": {
      const b = box();
      if (!b) return;
      out.push(["rect", { x: format(b.x), y: format(b.y), width: format(b.w), height: format(b.h) }]);
      return;
    }
    case "roundrect": {
      const b = box();
      if (!b) return;
      const arcsize = number(where, node, "arcsize", 0) || DEFAULT_ARCSIZE;
      const r = format((Math.min(b.rawW, b.rawH) * arcsize * s) / 100);
      out.push(["rect", { x: format(b.x), y: format(b.y), width: format(b.w), height: format(b.h), rx: r, ry: r }]);
      return;
    }
    case "ellipse": {
      const b = box();
      if (!b) return;
      out.push(["ellipse", { cx: format(b.x + b.w / 2), cy: format(b.y + b.h / 2), rx: format(b.w / 2), ry: format(b.h / 2) }]);
      return;
    }
    case "image":
    case "include-shape":
      fail(`${where}: <${node.name}> is refused (it draws no geometry of its own)`);
      return;
    default:
      fail(`${where}: <${node.name}> is not a stencil element this converter reads`);
  }
}

/** One stencil `<shape>` element as its shape list in the 24-unit box: background first, then foreground. */
export function convertStencil(shapeElement) {
  const where = `drawio shape ${JSON.stringify(shapeElement?.attrs?.name ?? "")}`;
  if (shapeElement?.name !== "shape") fail(`${where}: expected a <shape>, got <${shapeElement?.name}>`);
  const w = number(where, shapeElement, "w");
  const h = number(where, shapeElement, "h");
  if (!(w > 0) || !(h > 0)) fail(`${where}: the box ${w}×${h} has no size`);
  const m = normaliseTo24({ x: 0, y: 0, w, h });
  const sections = { background: null, foreground: null };
  for (const child of shapeElement.children) {
    if (child.name === "connections") continue;
    if (!(child.name in sections)) fail(`${where}: <${child.name}> is not a stencil section`);
    if (sections[child.name]) fail(`${where}: <${child.name}> appears twice`);
    sections[child.name] = child;
  }
  const out = [];
  for (const section of [sections.background, sections.foreground]) {
    if (section) for (const node of section.children) drawElement(where, node, m, out);
  }
  return out;
}

/** The `<shape>` named `name` in a parsed `<shapes>` set; refuses an absent or a repeated name. */
function shapeIn(root, name, setName) {
  if (root.name !== "shapes") fail(`drawio ${setName}: the root is <${root.name}>, not <shapes>`);
  const hits = root.children.filter((c) => c.name === "shape" && c.attrs.name === name);
  if (hits.length === 0) fail(`drawio ${setName}: no shape named ${JSON.stringify(name)}`);
  if (hits.length > 1) fail(`drawio ${setName}: ${hits.length} shapes are named ${JSON.stringify(name)}`);
  return hits[0];
}

/** The `<shape>` named `name` in a stencil set's XML text; refuses a name the set does not hold. */
export function findStencil(setXmlText, name) {
  const root = parseXml(setXmlText);
  return shapeIn(root, name, root.attrs.name ?? "set");
}

/** The paragraphs of the README's License section (a setext or an ATX heading), links read as their labels. */
function licenceSection(readme) {
  const lines = String(readme).split(/\r?\n/);
  const isRule = (l) => /^-{3,}\s*$|^={3,}\s*$/.test(l ?? "");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^License\s*$/.test(lines[i]) && isRule(lines[i + 1])) {
      start = i + 2;
      break;
    }
    if (/^#{1,6}\s+License\s*$/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return fail("drawio: the README at the pin has no License section");
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i]) || (lines[i].trim() !== "" && isRule(lines[i + 1]))) break;
    body.push(lines[i]);
  }
  return flattenLinks(body.join("\n").trim());
}

function load(dir) {
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  if (!readmeGrantsCcBy(readme)) {
    fail(`drawio: the README at ${DRAWIO_PIN} does not say "${GRANT}"; the owner's ruling rests on that sentence`);
  }
  const section = licenceSection(readme);
  if (!readmeGrantsCcBy(section)) fail(`drawio: the README's License section does not say "${GRANT}"`);
  const stencilsLicencePath = join(dir, "stencils", "LICENSE");
  const stencilsLicence = existsSync(stencilsLicencePath) ? readFileSync(stencilsLicencePath, "utf8").trim() : null;

  const licence = [
    `Pinned at jgraph/drawio@${DRAWIO_PIN} (v${VERSION}, ${PIN_DATE}).`,
    `The README at the pin, section "License":\n\n${section}`,
    ...(stencilsLicence ? [`src/main/webapp/stencils/LICENSE at the pin:\n\n${stencilsLicence}`] : []),
    `Licence URI: ${LICENCE_URL}`,
    `Attribution: ${AUTHOR}`,
  ].join("\n\n");

  const sets = new Map();
  const setOf = (entry) => {
    const set = entry?.set;
    if (typeof set !== "string" || !SET.test(set)) fail(`drawio:${entry?.name} set ${JSON.stringify(set)} is refused`);
    if (!sets.has(set)) sets.set(set, parseXml(readFileSync(join(dir, "stencils", ...`${set}.xml`.split("/")), "utf8")));
    return set;
  };
  const shapeName = (entry) => {
    if (typeof entry?.shape !== "string" || entry.shape === "") fail(`drawio:${entry?.name} has no shape name`);
    return entry.shape;
  };

  return {
    version: VERSION,
    conversion:
      `Converted by scripts/mimic-symbols/generate.mjs from the pid and electrical stencil sets of ` +
      `jgraph/drawio ${VERSION} into shape arrays of their geometry (text, colour and connection points ` +
      "dropped; each stencil fitted to a 24-unit box); the drawings are otherwise unchanged.",
    licence,
    shapes(entry) {
      const set = setOf(entry);
      return convertStencil(shapeIn(sets.get(set), shapeName(entry), set));
    },
    credit(entry) {
      const set = setOf(entry);
      return {
        author: AUTHOR,
        source: `src/main/webapp/stencils/${set}.xml#${shapeName(entry)}`,
        licence: LICENCE,
        licenceUrl: LICENCE_URL,
        pin: DRAWIO_PIN,
        adaptation: ADAPTATION,
      };
    },
  };
}

export const LIBRARY = {
  code: "drawio",
  constant: "DRAWIO",
  type: "DrawioSymbolKey",
  label: "draw.io",
  source: "jgraph/drawio stencils (pid, electrical)",
  pinned: VERSION,
  licenceName: LICENCE,
  attributionUrl: `https://github.com/jgraph/drawio/tree/${DRAWIO_PIN}/src/main/webapp/stencils`,
  style: "stroke",
  entryShape: "object",
  load,
};
