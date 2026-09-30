/**
 * `F3.32f` / ADR 0086 decision 9 — the QElectroTech elements source (`qet`), pinned at
 * `qelectrotech/qelectrotech-elements@3b12bc579b99932e3fe307ea1e44b8c1c6d1d5c9` (mirror tag
 * `0.100`). The files are fetched by `fetch-sources.mjs qet --out <dir>`; `generate.mjs --qet <dir>`
 * reads them.
 *
 * Curation (`curation/qet.json`): `{ "<group>": [{ "name": "<slug>", "path": "<path of the .elmt
 * under the repository root>" }] }`.
 *
 * The interface:
 * - `LIBRARY.load(dir)` → `{ version, licence, conversion, shapes(entry), credit(entry) }`:
 *   `version` equals `LIBRARY.pinned`; `licence` is `ELEMENTS.LICENSE` verbatim and the CC BY 3.0
 *   URI (plan D8); `conversion` names what the conversion leaves out (CC BY 3.0 §4(b) asks that a
 *   change be identified); `shapes(entry)` returns the element's shape list fitted to the 24-unit
 *   box (the generator checks it); `credit(entry)` returns `{ author, source, licence, licenceUrl,
 *   pin, adaptation }` for the attributions page — `adaptation` marks each row as an adaptation.
 * - `convertElmt(xmlText)` (also exported as `convertElement`) — pure: one `.elmt` document to
 *   `[tag, attrs][]` in the 24-unit box.
 *
 * The conversion (plan R11). The element box is the definition's `width` × `height` with its
 * origin at `-hotspot_x`, `-hotspot_y` (QElectroTech draws relative to the hotspot); one uniform
 * scale fits it into 24 × 24, centred. `line`, `rect`, `ellipse`, `circle` (`x`, `y` top-left and
 * `diameter`), `polygon` (`x1 y1 … xN yN`; `closed="false"` is a `polyline`) and `arc` map to the
 * SVG shapes. An `arc` is Qt's: `x y width height` its ellipse's box, `start` and `angle` in
 * degrees, counter-clockwise positive on a y-down canvas, so a point at θ is
 * (cx + rx·cos θ, cy − ry·sin θ) and a positive angle draws with SVG sweep 0; a full turn is an
 * ellipse. Texts, dynamic texts, terminals, inputs, line-end markers, fills and line styles are
 * left out; any other element is refused, named.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bakeShape, normaliseTo24 } from "../lib/geometry.mjs";
import { fail } from "../lib/grammar.mjs";
import { parseXml } from "../lib/xml.mjs";

export const QET_PIN = "3b12bc579b99932e3fe307ea1e44b8c1c6d1d5c9";
const PINNED = "0.100";
const LICENCE_URL = "https://creativecommons.org/licenses/by/3.0/";
/** Each credit row's note that the symbol is an adaptation (CC BY 3.0 §4(b), ADR 0086 decision 9). */
const ADAPTATION =
  "Adapted: converted to geometry, scaled into a 24-unit box; texts, terminals, line-end markers, fills and line styles removed.";
const DEFAULT_AUTHOR = "The QElectroTech team";

/** Description children that carry no outline: left out without a refusal. */
const DROPPED = new Set(["text", "dynamic_text", "terminal", "input"]);

/** A finite number from an attribute, or a refusal naming the element and the attribute. */
function number(node, name, fallback) {
  const raw = node.attrs[name];
  if (raw === undefined && fallback !== undefined) return fallback;
  const n = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n)) {
    fail(`qet: <${node.name}> ${name} ${JSON.stringify(raw)} is not a number`);
  }
  return n;
}

const DEG = Math.PI / 180;

/** Qt's arc as an SVG shape in element space: a path, or an ellipse for a full turn; null when empty. */
function arcShape(node) {
  const x = number(node, "x");
  const y = number(node, "y");
  const rx = number(node, "width") / 2;
  const ry = number(node, "height") / 2;
  const start = number(node, "start", 0);
  const angle = number(node, "angle");
  const cx = x + rx;
  const cy = y + ry;
  if (Math.abs(angle) >= 360) return ["ellipse", { cx, cy, rx, ry }];
  if (angle === 0 || rx <= 0 || ry <= 0) return null;
  const at = (deg) => [cx + rx * Math.cos(deg * DEG), cy - ry * Math.sin(deg * DEG)];
  const [x0, y0] = at(start);
  const [x1, y1] = at(start + angle);
  const large = Math.abs(angle) > 180 ? 1 : 0;
  // Qt turns counter-clockwise on screen for a positive angle; SVG's sweep 1 turns clockwise.
  const sweep = angle < 0 ? 1 : 0;
  return ["path", { d: `M${x0} ${y0} A${rx} ${ry} 0 ${large} ${sweep} ${x1} ${y1}` }];
}

/** `x1 y1 x2 y2 …` in their numeric order (a string sort would put x10 before x2). */
function polygonPoints(node) {
  const pairs = [];
  for (let i = 1; node.attrs[`x${i}`] !== undefined; i += 1) {
    pairs.push(`${number(node, `x${i}`)},${number(node, `y${i}`)}`);
  }
  if (pairs.length < 2) fail(`qet: <polygon> has ${pairs.length} point(s)`);
  return pairs.join(" ");
}

/** One description child as an SVG shape in element space; null when it is left out. */
function elementShape(node) {
  switch (node.name) {
    case "line":
      return ["line", { x1: number(node, "x1"), y1: number(node, "y1"), x2: number(node, "x2"), y2: number(node, "y2") }];
    case "rect": {
      const attrs = { x: number(node, "x"), y: number(node, "y"), width: number(node, "width"), height: number(node, "height") };
      const rx = number(node, "rx", 0);
      const ry = number(node, "ry", 0);
      if (rx > 0) attrs.rx = rx;
      if (ry > 0) attrs.ry = ry;
      return ["rect", attrs];
    }
    case "ellipse": {
      const rx = number(node, "width") / 2;
      const ry = number(node, "height") / 2;
      return ["ellipse", { cx: number(node, "x") + rx, cy: number(node, "y") + ry, rx, ry }];
    }
    case "circle": {
      const r = number(node, "diameter") / 2;
      return ["circle", { cx: number(node, "x") + r, cy: number(node, "y") + r, r }];
    }
    case "polygon":
      return [node.attrs.closed === "false" ? "polyline" : "polygon", { points: polygonPoints(node) }];
    case "arc":
      return arcShape(node);
    default:
      if (DROPPED.has(node.name)) return null;
      return fail(`qet: element <${node.name}> is outside the QElectroTech drawing set`);
  }
}

const child = (node, name) => node.children.find((c) => c.name === name);

/** One `.elmt` document as its shape list in the 24-unit box. */
export function convertElmt(xmlText) {
  const root = parseXml(xmlText);
  if (root.name !== "definition") fail(`qet: the root is <${root.name}>, not <definition>`);
  const w = number(root, "width");
  const h = number(root, "height");
  const m = normaliseTo24({ x: -number(root, "hotspot_x"), y: -number(root, "hotspot_y"), w, h });
  const description = child(root, "description");
  if (!description) fail("qet: the element has no <description>");
  // Direct children only: a dynamic_text's own <text> child is not a drawing.
  const shapes = description.children.map(elementShape).filter((s) => s !== null);
  if (shapes.length === 0) fail("qet: the element has no shape elements");
  return shapes.map((shape) => {
    const [tag, attrs] = shape;
    const text = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    return bakeShape([tag, text], m);
  });
}

export { convertElmt as convertElement };

/**
 * Contributors who sign an element's `<informations>` without an `Author:` prefix, as a line of
 * its own (measured over the curated files at the pin). Recognised by name, not guessed: a free
 * note such as "Rotation possible" is not an author.
 */
const SIGNED_LINES = [
  [/^Rafael Ferrando\.?$/m, "Rafael Ferrando"],
  [/^Baboune41(?:-\d{4})?$/m, "Baboune41"],
];

/**
 * The element's author: its `Author:` line, else a known contributor's signature line (both in
 * `<informations>`), else the QElectroTech team. CC BY 3.0 §4(c) credits the original author.
 */
export function authorOf(text) {
  const source = String(text);
  const informations = /<informations>([\s\S]*?)<\/informations>/.exec(source)?.[1] ?? source;
  const hit = /Author:[ \t]*([^\r\n<]+)/.exec(informations);
  const author = hit ? hit[1].trim() : "";
  if (author !== "") return author;
  const lines = informations
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n");
  for (const [pattern, name] of SIGNED_LINES) if (pattern.test(lines)) return name;
  return DEFAULT_AUTHOR;
}

/** The element's English name (`<names><name lang="en">`), or an empty string. */
export function englishNameOf(xmlText) {
  const names = child(parseXml(xmlText), "names");
  const en = names?.children.find((c) => c.name === "name" && c.attrs.lang === "en");
  return en ? en.text.trim() : "";
}

function load(dir) {
  const licenceFile = join(dir, "ELEMENTS.LICENSE");
  if (!existsSync(licenceFile)) fail(`qet: ${licenceFile} is missing; run fetch-sources.mjs qet first`);
  const read = (entry) => {
    const file = join(dir, ...String(entry.path).split("/"));
    if (!existsSync(file)) fail(`qet:${entry.name} ${entry.path} is not in ${dir}`);
    return readFileSync(file, "utf8");
  };
  return {
    version: PINNED,
    conversion:
      `Converted by scripts/mimic-symbols/generate.mjs from the .elmt element files of ${LIBRARY.source} ` +
      `at commit ${QET_PIN} (mirror tag ${PINNED}): each drawing is scaled into a 24-unit box, and its ` +
      "texts, terminals, line-end markers, fills and line styles are left out; the outlines are otherwise unchanged.",
    licence: `${readFileSync(licenceFile, "utf8").trim()}\n\nLicence URI: ${LICENCE_URL}`,
    shapes(entry) {
      try {
        return convertElmt(read(entry));
      } catch (error) {
        // Name the key: a converter refusal does not know which curated entry it serves.
        return fail(`qet:${entry.name} (${entry.path}): ${error.message}`);
      }
    },
    credit(entry) {
      return { author: authorOf(read(entry)), source: entry.path, licence: "CC BY 3.0", licenceUrl: LICENCE_URL, pin: QET_PIN, adaptation: ADAPTATION };
    },
  };
}

export const LIBRARY = {
  code: "qet",
  constant: "QET",
  type: "QetSymbolKey",
  label: "QElectroTech",
  source: "qelectrotech/qelectrotech-elements",
  pinned: PINNED,
  licenceName: "CC BY 3.0",
  attributionUrl: "https://qelectrotech.org/wiki/doc/elements_license",
  style: "stroke",
  entryShape: "object",
  load,
};
