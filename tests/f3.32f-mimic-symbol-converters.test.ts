import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  apply,
  bakePath,
  format,
  isBakeable,
  multiply,
  normaliseTo24,
  parseTransformList,
} from "../scripts/mimic-symbols/lib/geometry.mjs";
import { MIMIC_TRANSFORM_RE } from "../scripts/mimic-symbols/lib/grammar.mjs";
import { parseXml } from "../scripts/mimic-symbols/lib/xml.mjs";
import { convertStencil, findStencil, readmeGrantsCcBy } from "../scripts/mimic-symbols/sources/drawio.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** The lines strictly between the `mimic-transform-grammar` markers; throws when either is missing. */
const grammarBlock = (source: string, what: string): string => {
  const lines = source.split(/\r?\n/);
  const begin = lines.findIndex((l) => l.startsWith("// mimic-transform-grammar:begin"));
  const end = lines.findIndex((l) => l.startsWith("// mimic-transform-grammar:end"));
  if (begin < 0 || end <= begin) throw new Error(`${what}: no mimic-transform-grammar block`);
  return lines.slice(begin + 1, end).join("\n");
};

/**
 * `F3.32f` / ADR 0086 decision 9 (plan D6, R14) — the converter building blocks under
 * `scripts/mimic-symbols/lib/`: the affine geometry that fits a source drawing into the 24-unit
 * glyph box and bakes a matrix into its coordinates, the transform grammar the generator shares
 * with `@bms/shared`, and the XML walker the three sources read with. U1–U3 append their own
 * `describe` blocks for the QElectroTech, draw.io and Commons converters.
 * Assertions inline, no `.spec` sibling (§4.6).
 *
 * Mutation that reddens the arc claim: swap the `rx`/`ry` scaling in `bakeArc` (`rx * sd`,
 * `ry * sa` in the `turn === 0` branch) → "flips the sweep flag…" reddens.
 */
describe("geometry", () => {
  it("multiply composes two matrices, the second applied first", () => {
    expect(multiply([2, 0, 0, 2, 1, 1], [1, 0, 0, 1, 3, 4])).toEqual([2, 0, 0, 2, 7, 9]);
  });

  it("normaliseTo24 maps a 40×40 box centred on the origin onto 0–24", () => {
    const m = normaliseTo24({ x: -20, y: -20, w: 40, h: 40 });
    expect(apply(m, -20, -20)).toEqual([0, 0]);
    expect(apply(m, 20, 20)).toEqual([24, 24]);
  });

  it("normaliseTo24 fits a 120×30 box by one uniform scale, centred on (12, 12)", () => {
    const m = normaliseTo24({ x: 0, y: 0, w: 120, h: 30 });
    expect(apply(m, 0, 0)).toEqual([0, 9]);
    expect(apply(m, 120, 30)).toEqual([24, 15]);
  });

  it("bakePath takes a uniform scale and a translation into every command", () => {
    expect(bakePath("M0 0 L10 0 A5 5 0 0 1 20 0 h5 v5 z", [0.5, 0, 0, 0.5, 1, 1])).toBe(
      "M1 1 L6 1 A2.5 2.5 0 0 1 11 1 h2.5 v2.5 z",
    );
  });

  it("bakePath flips the sweep flag under a reflection and scales rx and ry separately", () => {
    expect(bakePath("M0 0 L10 0 A5 5 0 0 1 20 0 h5 v5 z", [2, 0, 0, -1, 0, 0])).toBe(
      "M0 0 L20 0 A10 5 0 0 0 40 0 h10 v-5 z",
    );
  });

  it("bakePath refuses a rotated arc under a non-uniform scale (U3 falls back to a transform)", () => {
    expect(() => bakePath("M0 0 A5 3 30 0 1 10 0", [2, 0, 0, 1, 0, 0])).toThrow(/not bakeable/);
  });

  it("bakePath refuses a matrix that skews", () => {
    expect(() => bakePath("M0 0 L1 1", [1, 0.1, 0, 1, 0, 0])).toThrow(/not bakeable/);
  });

  it("isBakeable is true for scale and translation only (positive control)", () => {
    expect(isBakeable([2, 0, 0, -1, 5, 5])).toBe(true);
  });

  it("isBakeable is false when b is non-zero", () => {
    expect(isBakeable([1, 0.1, 0, 1, 0, 0])).toBe(false);
  });

  it("isBakeable is false when c is non-zero", () => {
    expect(isBakeable([1, 0, 0.1, 1, 0, 0])).toBe(false);
  });

  it("format keeps at most two decimals", () => {
    expect(format(1.23456)).toBe("1.23");
  });

  it("format writes a tiny value as 0, never with an exponent", () => {
    expect(format(1e-7)).toBe("0");
  });

  it("format writes -0 as 0", () => {
    expect(format(-0)).toBe("0");
  });

  it("format writes an integer without a fraction", () => {
    expect(format(24)).toBe("24");
  });

  it("parseTransformList composes a list left to right", () => {
    expect(parseTransformList("translate(5,5) matrix(2,0,0,2,0,0)")).toEqual(
      multiply([1, 0, 0, 1, 5, 5], [2, 0, 0, 2, 0, 0]),
    );
  });

  // Mutation: widen TRANSFORM_SEP in lib/grammar.mjs to "[, ]+" → this claim reddens.
  it("the generator's transform grammar is the text of the shared MIMIC_TRANSFORM_RE", () => {
    const shared = grammarBlock(read("packages/shared/src/contracts/mimic-shapes.ts"), "mimic-shapes.ts");
    const generator = grammarBlock(read("scripts/mimic-symbols/lib/grammar.mjs"), "grammar.mjs");
    // Positive control: the block holds the expression, not an empty span between the markers.
    expect(shared).toContain("export const MIMIC_TRANSFORM_RE = new RegExp(");
    expect(generator).toBe(shared);
  });

  it("the generator's transform expression accepts a list and refuses a url (runtime control)", () => {
    expect(MIMIC_TRANSFORM_RE.test("translate(1 2) scale(2)")).toBe(true);
    expect(MIMIC_TRANSFORM_RE.test("url(#a)")).toBe(false);
  });
});

/**
 * Mutation: delete the CDATA branch in lib/xml.mjs → the generic markup-declaration branch answers
 * instead, and "refuses CDATA" reddens (its message names CDATA). Each refusal claim matches its
 * own message, so a branch that stops firing reddens its claim.
 */
describe("xml", () => {
  it("reads nested elements, both quote styles, text and a comment", () => {
    const root = parseXml(`<?xml version="1.0"?><a x="1" y='2'><!-- c --><b>hi &amp; bye</b><c/></a>`);
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ x: "1", y: "2" });
    expect(root.children.map((c: { name: string }) => c.name)).toEqual(["b", "c"]);
    expect(root.children[0].text).toBe("hi & bye");
  });

  it("refuses a document type", () => {
    expect(() => parseXml(`<!DOCTYPE a><a/>`)).toThrow(/document type/);
  });

  it("refuses an entity declaration", () => {
    expect(() => parseXml(`<a><!ENTITY x "y"></a>`)).toThrow(/entity declaration/);
  });

  it("refuses CDATA", () => {
    expect(() => parseXml(`<a><![CDATA[x]]></a>`)).toThrow(/CDATA/);
  });

  it("refuses a mismatched close tag", () => {
    expect(() => parseXml(`<a><b></a></b>`)).toThrow(/closes/);
  });

  it("refuses an element that is never closed", () => {
    expect(() => parseXml(`<a><b/>`)).toThrow(/never closed/);
  });
});

// U1 (F3.32f slice 2) — the QElectroTech converter. The imports sit with the block they serve so
// the U1, U2 and U3 blocks append without touching each other; ES imports are hoisted.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  LIBRARY as QET_LIBRARY,
  QET_PIN,
  authorOf,
  convertElement,
  englishNameOf,
} from "../scripts/mimic-symbols/sources/qet.mjs";

/** A 40×40 `.elmt` definition with its hotspot at the centre: the fit is x' = 0.6·x + 12. */
const elmt = (body: string, extra = ""): string =>
  `<definition version="0.100.0" type="element" width="40" height="40" hotspot_x="20" hotspot_y="20">` +
  `<names><name lang="fr">Bâche</name><name lang="en">Open tank</name></names>${extra}` +
  `<description>${body}</description></definition>`;

/** The numbers of a path's `d`, in order. */
const numbersOf = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * Mutations run and recorded: in sources/qet.mjs, change `cy - ry * sin` to `cy + ry * sin` →
 * "an arc starts and ends where Qt's angles put them" reddens; flip the sweep rule
 * (`angle < 0 ? 1 : 0` → `angle < 0 ? 0 : 1`) → "a clockwise arc (negative angle) has sweep 1"
 * reddens.
 */
describe("qet", () => {
  it("a line is fitted into the 24-unit box through the hotspot", () => {
    const shapes = convertElement(elmt(`<line x1="-10" y1="0" x2="10" y2="0" end1="none" end2="none"/>`));
    expect(shapes).toEqual([["line", { x1: "6", y1: "12", x2: "18", y2: "12" }]]);
  });

  it("a line-end marker is dropped, the line kept", () => {
    const shapes = convertElement(elmt(`<line x1="-10" y1="0" x2="10" y2="0" end1="simple" end2="triangle"/>`));
    expect(shapes).toEqual([["line", { x1: "6", y1: "12", x2: "18", y2: "12" }]]);
  });

  it("a rect keeps no rx or ry when they are zero", () => {
    const shapes = convertElement(elmt(`<rect x="-15" y="0" width="20" height="10" rx="0" ry="0"/>`));
    expect(shapes).toEqual([["rect", { x: "3", y: "12", width: "12", height: "6" }]]);
  });

  it("a rect keeps its corner radii when they are positive", () => {
    const shapes = convertElement(elmt(`<rect x="-15" y="0" width="20" height="10" rx="5" ry="2.5"/>`));
    expect(shapes).toEqual([["rect", { x: "3", y: "12", width: "12", height: "6", rx: "3", ry: "1.5" }]]);
  });

  it("an ellipse's bounding box becomes a centre and two radii", () => {
    const shapes = convertElement(elmt(`<ellipse x="-12" y="11" width="24" height="4"/>`));
    expect(shapes).toEqual([["ellipse", { cx: "12", cy: "19.8", rx: "7.2", ry: "1.2" }]]);
  });

  it("a circle's top-left corner and diameter become a centre and a radius", () => {
    const shapes = convertElement(elmt(`<circle x="-5" y="-5" diameter="10"/>`));
    expect(shapes).toEqual([["circle", { cx: "12", cy: "12", r: "3" }]]);
  });

  it("an open polygon (closed=false) becomes a polyline", () => {
    const shapes = convertElement(elmt(`<polygon x1="-10" y1="0" x2="0" y2="-10" x3="10" y3="0" closed="false"/>`));
    expect(shapes).toEqual([["polyline", { points: "6,12 12,6 18,12" }]]);
  });

  it("a polygon without closed stays a polygon", () => {
    const shapes = convertElement(elmt(`<polygon x1="-10" y1="0" x2="0" y2="-10" x3="10" y3="0"/>`));
    expect(shapes).toEqual([["polygon", { points: "6,12 12,6 18,12" }]]);
  });

  it("a polygon's points follow their number, not a string sort (x10 after x9)", () => {
    const attrs = Array.from({ length: 10 }, (_, i) => `x${i + 1}="${i}" y${i + 1}="0"`).join(" ");
    const [[, { points }]] = convertElement(elmt(`<polygon ${attrs}/>`));
    expect(points.split(" ").map((p: string) => Number(p.split(",")[0]))).toEqual([
      12, 12.6, 13.2, 13.8, 14.4, 15, 15.6, 16.2, 16.8, 17.4,
    ]);
  });

  it("an arc starts and ends where Qt's angles put them (counter-clockwise, y down)", () => {
    // cx 0, cy 33, rx 4, ry 2.5: start 270° is the bottom (0, 35.5), 270° + 180° the top (0, 30.5).
    const [[tag, { d }]] = convertElement(elmt(`<arc x="-4" y="30.5" width="8" height="5" start="270" angle="180"/>`));
    expect(tag).toBe("path");
    const n = numbersOf(d);
    expect([n[0], n[1]]).toEqual([12, 33.3]);
    expect([n[7], n[8]]).toEqual([12, 30.3]);
    expect(d).toBe("M12 33.3 A2.4 1.5 0 0 0 12 30.3");
  });

  it("a clockwise arc (negative angle) has sweep 1", () => {
    const [[, { d }]] = convertElement(elmt(`<arc x="-10" y="-10" width="20" height="20" start="0" angle="-90"/>`));
    expect(d).toBe("M18 12 A6 6 0 0 1 12 18");
  });

  it("an arc over 180 degrees takes the large-arc flag", () => {
    const [[, { d }]] = convertElement(elmt(`<arc x="-10" y="-10" width="20" height="20" start="0" angle="200"/>`));
    expect(numbersOf(d).slice(5, 7)).toEqual([1, 0]);
  });

  it("a full-turn arc becomes an ellipse", () => {
    const shapes = convertElement(elmt(`<arc x="-10" y="-5" width="20" height="10" start="30" angle="360"/>`));
    expect(shapes).toEqual([["ellipse", { cx: "12", cy: "12", rx: "6", ry: "3" }]]);
  });

  it("texts, dynamic texts, terminals and inputs are dropped", () => {
    const shapes = convertElement(
      elmt(
        `<line x1="-10" y1="0" x2="10" y2="0"/><text x="0" y="0" text="A"/>` +
          `<dynamic_text x="0" y="0"><text>x</text><info_name>label</info_name></dynamic_text>` +
          `<terminal x="0" y="-10" orientation="n"/><input x="0" y="0" text="_"/>`,
      ),
    );
    expect(shapes).toEqual([["line", { x1: "6", y1: "12", x2: "18", y2: "12" }]]);
  });

  it("a definition with only texts and terminals is refused", () => {
    expect(() => convertElement(elmt(`<text x="0" y="0" text="A"/><terminal x="0" y="-10" orientation="n"/>`))).toThrow(
      /has no shape elements/,
    );
  });

  it("an element outside the QElectroTech drawing set is refused, named", () => {
    expect(() => convertElement(elmt(`<image x="0" y="0"/>`))).toThrow(/<image>/);
  });

  it("the author is read from the informations Author: line", () => {
    expect(authorOf("<informations>Author: plc-user for QElectroTech\nLicense: see the wiki</informations>")).toBe(
      "plc-user for QElectroTech",
    );
  });

  it("a known contributor's signature line without Author: is credited to them", () => {
    expect(authorOf("<informations>Rafael Ferrando.\nMantenimiento de Instalaciones Térmicas</informations>")).toBe(
      "Rafael Ferrando",
    );
  });

  it("a contributor's dated signature is credited to the contributor", () => {
    expect(authorOf("<informations>Baboune41-2016</informations>")).toBe("Baboune41");
  });

  it("a free note in informations is not taken for an author", () => {
    expect(authorOf("<informations>Rotation possible</informations>")).toBe("The QElectroTech team");
  });

  it("an element without an Author: line is credited to the QElectroTech team", () => {
    expect(authorOf(elmt(`<line x1="0" y1="0" x2="1" y2="1"/>`))).toBe("The QElectroTech team");
  });

  it('the English name is read from <name lang="en">', () => {
    expect(englishNameOf(elmt(`<line x1="0" y1="0" x2="1" y2="1"/>`))).toBe("Open tank");
  });

  it("load() refuses a directory without ELEMENTS.LICENSE", () => {
    const dir = mkdtempSync(join(tmpdir(), "qet-"));
    try {
      expect(() => QET_LIBRARY.load(dir)).toThrow(/ELEMENTS\.LICENSE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("load() gives the pinned version, the licence with the CC BY 3.0 URI and a credit per entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "qet-"));
    try {
      writeFileSync(join(dir, "ELEMENTS.LICENSE"), "[en]\nThis work is licensed under the Creative Commons Attribution 3.0 License.\n");
      writeFileSync(
        join(dir, "tank.elmt"),
        elmt(`<line x1="-10" y1="0" x2="10" y2="0"/>`, "<informations>Author: plc-user\nLicense: x</informations>"),
      );
      const source = QET_LIBRARY.load(dir);
      expect(source.version).toBe(QET_LIBRARY.pinned);
      expect(source.licence).toContain("Creative Commons Attribution 3.0 License");
      expect(source.licence).toContain("https://creativecommons.org/licenses/by/3.0/");
      expect(source.shapes({ name: "tank", path: "tank.elmt" })).toEqual([["line", { x1: "6", y1: "12", x2: "18", y2: "12" }]]);
      expect(source.credit({ name: "tank", path: "tank.elmt" })).toEqual({
        author: "plc-user",
        source: "tank.elmt",
        licence: "CC BY 3.0",
        licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
        pin: QET_PIN,
        adaptation:
          "Adapted: converted to geometry, scaled into a 24-unit box; texts, terminals, line-end markers, fills and line styles removed.",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `F3.32f` / ADR 0086 decision 9, the `drawio` bullet — the mxGraph stencil converter in
 * `scripts/mimic-symbols/sources/drawio.mjs`. A 100×50 stencil fits the 24-unit box by the scale
 * 0.24 and sits 6 units down, so (x, y) becomes (0.24·x, 0.24·y + 6).
 *
 * Mutation that reddens the first claim: in `convertStencil`, give `normaliseTo24` the box
 * `{ x: 0, y: 0, w, h: w }` (the height dropped) → the line lands at "M0 0 L24 12".
 */
describe("drawio", () => {
  const stencil = (inner: string, attrs = 'name="X" w="100" h="50"') => parseXml(`<shape ${attrs}>${inner}</shape>`);
  const fg = (inner: string) => stencil(`<foreground>${inner}</foreground>`);
  const line = `<path><move x="0" y="0"/><line x="100" y="50"/></path>`;

  it("a path of move and line fits the 24-unit box by one scale, the height centred", () => {
    expect(convertStencil(fg(`${line}<stroke/>`))).toEqual([["path", { d: "M0 6 L24 18" }]]);
  });

  it("an arc keeps the stencil's operand order: rx ry rotation large-arc sweep x y, radii scaled", () => {
    const arc = `<arc rx="50" ry="25" x-axis-rotation="30" large-arc-flag="1" sweep-flag="0" x="100" y="25"/>`;
    expect(convertStencil(fg(`<path><move x="0" y="25"/>${arc}</path>`))).toEqual([
      ["path", { d: "M0 12 A12 6 30 1 0 24 12" }],
    ]);
  });

  it("a quad becomes Q with both points baked", () => {
    expect(convertStencil(fg(`<path><move x="0" y="0"/><quad x1="50" y1="0" x2="100" y2="50"/></path>`))).toEqual([
      ["path", { d: "M0 6 Q12 6 24 18" }],
    ]);
  });

  it("a curve becomes C with its three points baked", () => {
    const curve = `<curve x1="25" y1="0" x2="75" y2="50" x3="100" y3="0"/>`;
    expect(convertStencil(fg(`<path><move x="0" y="0"/>${curve}</path>`))).toEqual([
      ["path", { d: "M0 6 C6 6 18 18 24 6" }],
    ]);
  });

  it("a close becomes Z", () => {
    const path = `<path><move x="0" y="0"/><line x="100" y="0"/><line x="100" y="50"/><close/></path>`;
    expect(convertStencil(fg(path))).toEqual([["path", { d: "M0 6 L24 6 L24 18 Z" }]]);
  });

  it("a rect becomes a rect in the box", () => {
    expect(convertStencil(fg(`<rect x="10" y="5" w="50" h="25"/>`))).toEqual([
      ["rect", { x: "2.4", y: "7.2", width: "12", height: "6" }],
    ]);
  });

  // mxStencil.js at the pin: arcsize is a percentage of the shorter side.
  it("a roundrect becomes a rect with rx = ry = min(w, h) · arcsize / 100, scaled", () => {
    expect(convertStencil(fg(`<roundrect x="0" y="0" w="100" h="50" arcsize="20"/>`))).toEqual([
      ["rect", { x: "0", y: "6", width: "24", height: "12", rx: "2.4", ry: "2.4" }],
    ]);
  });

  it("a roundrect without arcsize takes mxGraph's default of 15", () => {
    expect(convertStencil(fg(`<roundrect x="0" y="0" w="100" h="50"/>`))).toEqual([
      ["rect", { x: "0", y: "6", width: "24", height: "12", rx: "1.8", ry: "1.8" }],
    ]);
  });

  // mxStencil.js reads an absent attribute as Number(null) = 0; the stencils use a bare <rect/>.
  it("a rect without attributes draws nothing, and an absent x or y reads as 0", () => {
    expect(convertStencil(fg(`${line}<rect/><rect w="50" h="25"/>`))).toEqual([
      ["path", { d: "M0 6 L24 18" }],
      ["rect", { x: "0", y: "6", width: "12", height: "6" }],
    ]);
  });

  it("an ellipse becomes an ellipse by its centre and radii", () => {
    expect(convertStencil(fg(`<ellipse x="0" y="0" w="100" h="50"/>`))).toEqual([
      ["ellipse", { cx: "12", cy: "12", rx: "12", ry: "6" }],
    ]);
  });

  it("paint, state and connection elements change nothing", () => {
    const paint =
      `<fillstroke/><stroke/><fill/><fillcolor color="#ff0000"/><strokecolor color="#00ff00"/><strokewidth width="2"/>` +
      `<dashed dashed="1"/><dashpattern pattern="3 3"/><linejoin join="round"/><linecap cap="round"/>` +
      `<miterlimit limit="4"/><alpha alpha="0.5"/><fillalpha alpha="0.5"/><strokealpha alpha="0.5"/><save/><restore/>`;
    const bare = convertStencil(fg(`${line}<ellipse x="0" y="0" w="100" h="50"/>`));
    const painted = parseXml(
      `<shape name="X" w="100" h="50"><connections><constraint name="N" x="0.5" y="0" perimeter="0"/></connections>` +
        `<foreground>${paint}${line}${paint}<ellipse x="0" y="0" w="100" h="50"/>${paint}</foreground></shape>`,
    );
    expect(bare).toHaveLength(2);
    expect(convertStencil(painted)).toEqual(bare);
  });

  it("text and the font elements are dropped", () => {
    const text =
      `<fontsize size="12"/><fontcolor color="#000000"/><fontstyle style="1"/><fontfamily family="Arial"/>` +
      `<text str="FT" x="50" y="25" align="center" valign="middle"/>`;
    expect(convertStencil(fg(`${text}${line}`))).toEqual([["path", { d: "M0 6 L24 18" }]]);
  });

  it("an image is refused by name", () => {
    expect(() => convertStencil(fg(`${line}<image src="x.png" x="0" y="0" w="10" h="10"/>`))).toThrow(/<image>/);
  });

  it("an include-shape is refused by name", () => {
    expect(() => convertStencil(fg(`${line}<include-shape name="y" x="0" y="0" w="10" h="10"/>`))).toThrow(
      /<include-shape>/,
    );
  });

  it("an unknown element is refused by name", () => {
    expect(() => convertStencil(fg(`${line}<blob/>`))).toThrow(/<blob>/);
  });

  it("the background comes before the foreground, and both are drawn", () => {
    const shape = stencil(
      `<foreground><ellipse x="0" y="0" w="100" h="50"/></foreground><background><rect x="0" y="0" w="100" h="50"/></background>`,
    );
    expect(convertStencil(shape).map(([tag]: [string]) => tag)).toEqual(["rect", "ellipse"]);
  });

  it("findStencil finds a shape by its name in a set (positive control)", () => {
    const set = `<shapes name="mxGraph.pid.pumps"><shape name="Pump A" w="10" h="10"/><shape name="Pump B" w="20" h="10"/></shapes>`;
    expect(findStencil(set, "Pump B").attrs.w).toBe("20");
  });

  it("findStencil refuses a shape name the set does not hold", () => {
    const set = `<shapes name="mxGraph.pid.pumps"><shape name="Pump A" w="10" h="10"/></shapes>`;
    expect(() => findStencil(set, "Pump Z")).toThrow(/Pump Z/);
  });

  it("readmeGrantsCcBy is true for the sentence in plain text", () => {
    expect(readmeGrantsCcBy("The JGraph provided icons are licensed under the CC BY 4.0. More.")).toBe(true);
  });

  // The README at the pin writes the licence name as a markdown link.
  it("readmeGrantsCcBy is true for the sentence with the licence name as a markdown link", () => {
    expect(
      readmeGrantsCcBy(
        "The JGraph provided icons and diagram templates are licensed under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Additional terms may also apply.",
      ),
    ).toBe(true);
  });

  it("readmeGrantsCcBy is false for the current README's wording", () => {
    const current =
      "The source code in this repository is licensed under the [Apache License 2.0](LICENSE).\n\n" +
      "Some icons are originally defined by third-party copyright holders; we have verified that all original licenses permit use in this project.";
    expect(readmeGrantsCcBy(current)).toBe(false);
  });
});

// The wmpid block's imports sit beside it (ES imports are hoisted), so U1–U3's appended blocks
// merge without touching one another's lines.
import { createHash } from "node:crypto";

import { MIMIC_TRANSFORM_RE as SHARED_TRANSFORM_RE } from "../packages/shared/src/contracts/mimic-shapes";
import { MIMIC_FETCH_USER_AGENT, WMPID_PAUSE_MS } from "../scripts/mimic-symbols/fetch-sources.mjs";
import { LIBRARY as WMPID_LIBRARY, classifyLicence, convertSvg, verifyPin } from "../scripts/mimic-symbols/sources/wmpid.mjs";

type WmShape = [string, Record<string, string>];

/** An SVG document with `body` under a root that has `rootAttrs` (default a 24-unit viewBox). */
const svgDoc = (body: string, rootAttrs = 'viewBox="0 0 24 24"'): string =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${body}</svg>`;

// `numbersOf` (every number of a path's data, in order) is declared once, with the qet block.

const KEPT_LINE = '<line x1="1" y1="1" x2="2" y2="2" style="fill:none;stroke:#000000"/>';

/**
 * `F3.32f` / ADR 0086 decision 9 (`wmpid`, and "`transform` joins the attribute list"; plan D6) —
 * the Wikimedia Commons converter: an Inkscape SVG document to shapes in the 24-unit box. A
 * shape's group chain, its own transform and the box fit compose into one matrix; without a
 * rotation or skew it is baked, otherwise the shape keeps its coordinates and carries
 * `transform="matrix(…)"`. Invisible shapes are dropped; metadata elements are skipped; active or
 * referencing elements are refused, naming the element. Assertions inline, no `.spec` sibling (§4.6).
 *
 * Mutation that reddens the first claim: skip the parent `g` transform in `convertSvg`'s walk
 * (compose the child's chain from the identity) → "bakes a group chain…" reddens on its endpoints.
 * A degenerate arc (`A 0,0 …`) is kept as written: the renderer draws nothing for it.
 */
describe("wmpid", () => {
  it("bakes a group chain and the shape's own scale into one path, with no transform key", () => {
    const shapes: WmShape[] = convertSvg(
      '<svg viewBox="0 0 70 70"><g transform="translate(5,5)"><path transform="matrix(2,0,0,2,0,0)" d="M0 0 L10 10" style="fill:none;stroke:#000"/></g></svg>',
    );
    expect(shapes).toHaveLength(1);
    const [tag, attrs] = shapes[0];
    expect(tag).toBe("path");
    expect(Object.keys(attrs)).toEqual(["d"]);
    const [x1, y1, x2, y2] = numbersOf(attrs.d);
    expect(x1).toBeCloseTo(1.71, 2);
    expect(y1).toBeCloseTo(1.71, 2);
    expect(x2).toBeCloseTo(8.57, 2);
    expect(y2).toBeCloseTo(8.57, 2);
  });

  it("keeps the coordinates and carries a matrix transform in the shared grammar when the chain skews", () => {
    const shapes: WmShape[] = convertSvg(
      '<svg viewBox="0 0 70 70"><g transform="translate(5,5)"><path transform="matrix(1,0.1,0,1,0,0)" d="M0 0 L10 10" style="fill:none;stroke:#000"/></g></svg>',
    );
    expect(shapes).toHaveLength(1);
    const [tag, attrs] = shapes[0];
    expect(tag).toBe("path");
    expect(attrs.d).toBe("M0 0 L10 10");
    expect(attrs.transform).toMatch(/^matrix\(/);
    expect(SHARED_TRANSFORM_RE.test(attrs.transform)).toBe(true);
  });

  it("derives the box from width and height when the root has no viewBox", () => {
    const shapes: WmShape[] = convertSvg(
      svgDoc('<line x1="0" y1="0" x2="70.866142" y2="70.866142" style="stroke:#000"/>', 'width="70.866142" height="70.866142"'),
    );
    expect(shapes).toEqual([["line", { x1: "0", y1: "0", x2: "24", y2: "24" }]]);
  });

  // Without a viewBox the content is drawn in CSS px: 70.866142 mm is 267.84 px, so a line to
  // (70.866142, 70.866142) covers 24 × 25.4 / 96 = 6.35 units of the box, not all 24.
  it("derives the box from width and height given in mm, converted to px", () => {
    const shapes: WmShape[] = convertSvg(
      svgDoc('<line x1="0" y1="0" x2="70.866142" y2="70.866142" style="stroke:#000"/>', 'width="70.866142mm" height="70.866142mm"'),
    );
    expect(shapes).toEqual([["line", { x1: "0", y1: "0", x2: "6.35", y2: "6.35" }]]);
  });

  it("derives the box from width and height given in pt, converted to px (72 pt = 96 px)", () => {
    const shapes: WmShape[] = convertSvg(
      svgDoc('<line x1="0" y1="0" x2="72" y2="72" style="stroke:#000"/>', 'width="72pt" height="72pt"'),
    );
    expect(shapes).toEqual([["line", { x1: "0", y1: "0", x2: "18", y2: "18" }]]);
  });

  it("turns a circle under a non-uniform scale into an ellipse", () => {
    const shapes: WmShape[] = convertSvg(
      svgDoc('<g transform="matrix(1,0,0,2,0,0)"><circle cx="4" cy="4" r="2" style="stroke:#000"/></g>'),
    );
    expect(shapes).toEqual([["ellipse", { cx: "4", cy: "8", rx: "2", ry: "4" }]]);
  });

  it("drops a white-filled shape with no stroke and keeps its visible sibling", () => {
    const shapes: WmShape[] = convertSvg(svgDoc(`<rect x="1" y="1" width="4" height="4" style="fill:#ffffff;stroke:none"/>${KEPT_LINE}`));
    expect(shapes.map(([tag]) => tag)).toEqual(["line"]);
  });

  it("keeps a black-filled shape with no stroke", () => {
    const shapes: WmShape[] = convertSvg(svgDoc('<rect x="1" y="1" width="4" height="4" style="fill:#000000;stroke:none"/>'));
    expect(shapes).toEqual([["rect", { x: "1", y: "1", width: "4", height: "4" }]]);
  });

  it("drops a shape under display:none and keeps its visible sibling", () => {
    const shapes: WmShape[] = convertSvg(svgDoc(`<rect x="1" y="1" width="4" height="4" style="display:none;stroke:#000"/>${KEPT_LINE}`));
    expect(shapes.map(([tag]) => tag)).toEqual(["line"]);
  });

  it("reads fill and stroke presentation attributes like the style", () => {
    const shapes: WmShape[] = convertSvg(svgDoc(`<rect x="1" y="1" width="4" height="4" fill="white" stroke="none"/>${KEPT_LINE}`));
    expect(shapes.map(([tag]) => tag)).toEqual(["line"]);
  });

  it("skips defs, metadata, sodipodi:namedview, title, desc and inkscape elements without a refusal", () => {
    const shapes: WmShape[] = convertSvg(
      svgDoc(
        '<defs><linearGradient id="g"/></defs><metadata><rdf:RDF/></metadata>' +
          '<sodipodi:namedview id="base"><inkscape:grid id="grid"/></sodipodi:namedview>' +
          `<title>t</title><desc>d</desc><inkscape:perspective id="p"/>${KEPT_LINE}`,
      ),
    );
    expect(shapes.map(([tag]) => tag)).toEqual(["line"]);
  });

  it.each([
    ["text", "<text>A</text>"],
    ["use", '<use href="#a"/>'],
    ["image", '<image href="a.png"/>'],
    ["style", "<style>.a{}</style>"],
    ["script", "<script>x</script>"],
    ["linearGradient", '<linearGradient id="a"/>'],
    ["radialGradient", '<radialGradient id="a"/>'],
    ["clipPath", '<clipPath id="a"/>'],
    ["mask", '<mask id="a"/>'],
    ["filter", '<filter id="a"/>'],
    ["symbol", '<symbol id="a"/>'],
    ["a", '<a href="#x"><rect x="1" y="1" width="2" height="2"/></a>'],
    ["foreignObject", "<foreignObject/>"],
  ])("refuses a <%s> element, naming it", (name, body) => {
    expect(() => convertSvg(svgDoc(`${KEPT_LINE}${body}`))).toThrow(new RegExp(`<${name}>`));
  });

  it("refuses a document type", () => {
    expect(() => convertSvg(`<!DOCTYPE svg><svg viewBox="0 0 24 24">${KEPT_LINE}</svg>`)).toThrow(/document type/);
  });

  it("keeps a degenerate arc as written (the renderer draws nothing for it)", () => {
    const shapes: WmShape[] = convertSvg(svgDoc('<path d="M5 5 A 0,0 0 1 1 5,5 z" style="stroke:#000"/>'));
    expect(shapes).toEqual([["path", { d: "M5 5 A0 0 0 1 1 5 5 z" }]]);
  });

  it("verifyPin is true for the sha1 of the bytes", () => {
    const bytes = Buffer.from(svgDoc(KEPT_LINE), "utf8");
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    expect(verifyPin(bytes, sha1)).toBe(true);
  });

  it("verifyPin is false after one byte changes", () => {
    const bytes = Buffer.from(svgDoc(KEPT_LINE), "utf8");
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    const changed = Buffer.from(bytes);
    changed[changed.length - 2] ^= 1;
    expect(verifyPin(changed, sha1)).toBe(false);
  });

  it("classifyLicence labels a threshold-of-originality template", () => {
    expect(classifyLicence({ licence: "Public domain", templates: ["PD-textlogo"] })).toBe(
      "Public domain — PD-textlogo (threshold of originality)",
    );
  });

  /** A curated Commons entry for `credit()`; it reads no file. */
  const DIODE = {
    name: "diode",
    title: "File:Diode01.svg",
    sha1: "b517cc916d51af274163a6324cdd78a83122c243",
    timestamp: "2013-07-04T08:26:18Z",
    licence: "Public domain",
    templates: ["PD-self"],
  };

  it("credit() gives the curated author and an adaptation note (positive control)", () => {
    const credit = WMPID_LIBRARY.load("unused").credit({ ...DIODE, author: "Knutux" });
    expect(credit.author).toBe("Knutux");
    expect(credit.adaptation).toMatch(/^Adapted: converted to geometry/);
  });

  it("credit() refuses an empty author, naming the file, and never prints unknown", () => {
    expect(() => WMPID_LIBRARY.load("unused").credit({ ...DIODE, author: " " })).toThrow(/wmpid:diode \(File:Diode01\.svg\) has no author/);
  });

  it("classifyLicence labels a CC0 file as CC0", () => {
    expect(classifyLicence({ licence: "CC0", templates: ["Cc-zero"] })).toMatch(/^CC0/);
  });

  it("fetch-sources pauses at least 1.5 s between Commons requests", () => {
    expect(typeof WMPID_PAUSE_MS).toBe("number");
    expect(WMPID_PAUSE_MS).toBeGreaterThanOrEqual(1500);
  });

  // upload.wikimedia.org answered HTTP 429 (retry-after 600) to a User-Agent without a contact
  // URL and 200 to one with it (U3, 2026-09-30); the Wikimedia User-Agent policy asks for one.
  it("the fetch User-Agent carries an https contact URL", () => {
    expect(MIMIC_FETCH_USER_AGENT).toMatch(/^TRINETRA-mimic-symbols\/\d+\.\d+ \(https:\/\/[^\s;()]+;/);
  });

  // A 3xx from an allowed host would otherwise take Node's fetch (redirect: "follow") to any host.
  it.each(["scripts/mimic-symbols/fetch-sources.mjs", "scripts/mimic-symbols/wmpid-curate.mjs"])(
    "every fetch call in %s refuses a redirect",
    (rel) => {
      const calls = [...read(rel).matchAll(/\bfetch\(([^;]*)\);/g)].map((m) => m[1] as string);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.filter((call) => !/redirect: "error"/.test(call))).toEqual([]);
    },
  );

  it("wmpid-curate sends the same User-Agent as fetch-sources", () => {
    const curate = read("scripts/mimic-symbols/wmpid-curate.mjs");
    expect(curate).toMatch(/import \{ MIMIC_FETCH_USER_AGENT \} from "\.\/fetch-sources\.mjs";/);
    expect(curate).toMatch(/"User-Agent": MIMIC_FETCH_USER_AGENT/);
    expect(curate).not.toMatch(/const USER_AGENT/);
  });
});
