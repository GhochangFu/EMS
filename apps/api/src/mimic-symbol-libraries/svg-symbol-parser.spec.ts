import { expect } from "vitest";

import { MIMIC_SHAPE_ATTRS } from "@bms/shared";
import type { MimicShape } from "@bms/shared";

import { SvgSymbolRefusal, parseSvgSymbol } from "./svg-symbol-parser";

/**
 * `F3.32f` slice 3 / ADR 0086 decision 6 (plan D7, §3 U2) — the upload parser. Assertions live
 * here; `svg-symbol-parser.test.ts` is the Vitest entry point (ADR 0014), one `it()` per claim.
 *
 * Every fixture is an inline string. A refusal asserts the **exact** message, and that the
 * message never carries the fixture's payload — each payload is a token (`pwn7f3e…`) that no
 * message spells, so the `not.toContain` cannot pass by an accidental overlap with an element
 * name. The exact message is what makes the DOCTYPE mutation redden its own claim: without the
 * `doctype` handler the entity-free DOCTYPE fixture parses, rather than failing on something
 * else.
 */

const PAYLOAD = "pwn7f3e";

const svg = (body: string, viewBox = "0 0 24 24"): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

const DRAWS = '<path d="M2 2 L22 22"/>';

function parse(xml: string): ReturnType<typeof parseSvgSymbol> {
  return parseSvgSymbol(Buffer.from(xml, "utf8"));
}

function refusalOf(xml: string): SvgSymbolRefusal {
  try {
    parse(xml);
  } catch (err) {
    expect(err).toBeInstanceOf(SvgSymbolRefusal);
    return err as SvgSymbolRefusal;
  }
  throw new Error("expected the parser to refuse the file, and it accepted it");
}

/** The message is exactly `message`, and never carries `payload`. */
export function assertRefusalNamesTheElementAndNotTheContent(xml: string, message: string, payload = PAYLOAD): void {
  const refusal = refusalOf(xml);
  expect(refusal.message).toBe(message);
  expect(refusal.message).not.toContain(payload);
}

/** Every stored attribute object's keys are inside `MIMIC_SHAPE_ATTRS`. */
export function assertAttrsWithinTheAllowlist(shapes: readonly MimicShape[]): void {
  const allowed = new Set<string>(MIMIC_SHAPE_ATTRS);
  const outside = shapes.flatMap(([, attrs]) => Object.keys(attrs).filter((key) => !allowed.has(key)));
  expect(outside, "an attribute outside MIMIC_SHAPE_ATTRS reached a stored shape").toEqual([]);
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** An entity-free DOCTYPE on an otherwise valid file: the `doctype` handler is the only refusal. */
export function runDoctypeIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://${PAYLOAD}.test/svg11.dtd">${svg(DRAWS)}`,
    "A DOCTYPE is not allowed in a symbol",
  );
}

/** saxes resolves only the five XML entities and reports any other as an `error` event. */
export function runUndefinedEntityIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<path d="&${PAYLOAD};"/>`),
    "The file is not well-formed XML",
  );
}

export function runProcessingInstructionIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    `<?xml version="1.0"?><?php echo "${PAYLOAD}"; ?>${svg(DRAWS)}`,
    "A processing instruction is not allowed in a symbol",
  );
}

export function runCdataIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`${DRAWS}<![CDATA[${PAYLOAD}]]>`),
    "A CDATA section is not allowed in a symbol",
  );
}

const elementRefusal = (name: string): string => `Element <${name}> is not allowed in a symbol`;

export function runScriptIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`${DRAWS}<script>${PAYLOAD}()</script>`), elementRefusal("script"));
}

export function runStyleElementIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<style>path { fill: url(#${PAYLOAD}) }</style>${DRAWS}`),
    elementRefusal("style"),
  );
}

export function runUseIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`${DRAWS}<use href="#${PAYLOAD}"/>`), elementRefusal("use"));
}

export function runImageIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`${DRAWS}<image href="http://${PAYLOAD}.test/x.png" width="1" height="1"/>`),
    elementRefusal("image"),
  );
}

export function runForeignObjectIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`${DRAWS}<foreignObject width="1" height="1"><div xmlns="http://www.w3.org/1999/xhtml">${PAYLOAD}</div></foreignObject>`),
    elementRefusal("foreignObject"),
  );
}

export function runAnchorIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<a href="javascript:${PAYLOAD}()">${DRAWS}</a>`),
    elementRefusal("a"),
  );
}

export function runTextElementIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`${DRAWS}<text x="1" y="1">${PAYLOAD}</text>`), elementRefusal("text"));
}

export function runGradientInsideDefsIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<defs><linearGradient id="${PAYLOAD}"><stop offset="0"/></linearGradient></defs>${DRAWS}`),
    "Element <linearGradient> inside <defs> is not allowed in a symbol",
  );
}

export function runFilterIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<filter id="${PAYLOAD}"><feGaussianBlur stdDeviation="2"/></filter>${DRAWS}`),
    elementRefusal("filter"),
  );
}

export function runUnknownElementIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`<mask id="${PAYLOAD}">${DRAWS}</mask>`), elementRefusal("mask"));
}

/** A hostile tag name is capped at 32 characters with its punctuation stripped. */
export function runARefusedElementNameIsCappedAndStripped(): void {
  const long = `x${"y".repeat(60)}`;
  assertRefusalNamesTheElementAndNotTheContent(svg(`<${long}/>${DRAWS}`), elementRefusal(long.slice(0, 32)), long);
}

export function runNonWhitespaceTextIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`${DRAWS}${PAYLOAD}`), "Text content is not allowed in a symbol");
}

export function runARootThatIsNotSvgIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    `<html data-x="${PAYLOAD}">${DRAWS}</html>`,
    "The root element <html> is not svg",
  );
}

export function runAMissingViewBoxIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" data-x="${PAYLOAD}">${DRAWS}</svg>`,
    "Element <svg> needs a viewBox of four numbers",
  );
}

export function runAThreeNumberViewBoxIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(DRAWS, "0 0 24"), "Element <svg> needs a viewBox of four numbers");
}

export function runANumberWithAUnitIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<circle cx="10${PAYLOAD}" cy="12" r="4"/>`),
    "Attribute cx of <circle> is not in the shape grammar",
  );
}

export function runANumberWithPxIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg('<circle cx="10px" cy="12" r="4"/>'),
    "Attribute cx of <circle> is not in the shape grammar",
    "10px",
  );
}

export function runPathDataOutsideTheGrammarIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<path d="M0 0 javascript:${PAYLOAD}"/>`),
    "Attribute d of <path> is not in the shape grammar",
  );
}

export function runPathDataOverTheBoundIsRefused(): void {
  const d = `M${"1".repeat(8192)}`;
  expect(d).toHaveLength(8193);
  assertRefusalNamesTheElementAndNotTheContent(svg(`<path d="${d}"/>`), "Attribute d of <path> is not in the shape grammar", d);
}

export function runATransformWithAUrlIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<path transform="url(#${PAYLOAD})" d="M0 0 L1 1"/>`),
    "Attribute transform of <path> is not in the shape grammar",
  );
}

export function runAGroupTransformWithAUrlIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<g transform="url(#${PAYLOAD})">${DRAWS}</g>`),
    "Attribute transform of <g> is not in the shape grammar",
  );
}

export function runMoreThan200ShapesIsRefused(): void {
  const rects = '<rect x="1" y="1" width="2" height="2"/>'.repeat(201);
  assertRefusalNamesTheElementAndNotTheContent(svg(rects), "A symbol holds at most 200 shapes");
}

export function run200ShapesIsAccepted(): void {
  const rects = '<rect x="1" y="1" width="2" height="2"/>'.repeat(200);
  expect(parse(svg(rects)).shapes).toHaveLength(200);
}

export function runAFileThatDrawsNothingIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`<g id="${PAYLOAD}"></g>`), "The file draws nothing");
}

export function runMalformedXmlIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`<path d="M0 0 L1 1"/><g data-x="${PAYLOAD}">`), "The file is not well-formed XML");
}

export function runTwoRootsAreRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(`${svg(DRAWS)}<svg data-x="${PAYLOAD}"/>`, "The file is not well-formed XML");
}

export function runANestedSvgIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(svg(`<svg viewBox="0 0 1 1" id="${PAYLOAD}">${DRAWS}</svg>`), elementRefusal("svg"));
}

export function runAnElementInsideAShapeIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<path d="M0 0 L1 1"><animate attributeName="d" to="${PAYLOAD}"/></path>`),
    "Element <animate> inside <path> is not allowed in a symbol",
  );
}

export function runAnEmptyFileIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent("", "The file is not well-formed XML");
}

// ---------------------------------------------------------------------------
// Drops — never stored
// ---------------------------------------------------------------------------

/** Every attribute outside the allowlist is dropped silently; the geometry stays. */
export function runDroppedAttributesNeverReachTheShapes(): void {
  const { shapes } = parse(
    svg(
      `<path onload="${PAYLOAD}()" style="fill:red" fill="red" stroke="#000" class="c" href="#h" ` +
        `xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#x" id="p1" ` +
        `sodipodi:nodetypes="cc" inkscape:connector-curvature="0" d="M2 2 L22 22"/>`,
    ),
  );
  expect(shapes).toEqual([["path", { d: "M2 2 L22 22" }]]);
  assertAttrsWithinTheAllowlist(shapes);
  expect(JSON.stringify(shapes)).not.toContain(PAYLOAD);
}

/** Positive control: the allowlist assertion refuses a planted key, so it cannot pass vacuously. */
export function runTheAllowlistAssertionRefusesAPlantedKey(): void {
  const planted = [["path", { d: "M0 0", onload: "x" }]] as unknown as MimicShape[];
  expect(() => assertAttrsWithinTheAllowlist(planted)).toThrow();
}

/** Editor metadata elements are dropped with their subtrees, text and namespaced children included. */
export function runEditorMetadataIsDropped(): void {
  const { shapes } = parse(
    svg(
      '<sodipodi:namedview id="nv" pagecolor="#fff"><inkscape:grid type="xygrid"/></sodipodi:namedview>' +
        `<title>${PAYLOAD} title</title><desc>${PAYLOAD} desc</desc>` +
        `<metadata><rdf:RDF><cc:Work rdf:about=""><dc:title>${PAYLOAD}</dc:title></cc:Work></rdf:RDF></metadata>` +
        "<defs/><defs>\n  </defs>" +
        `<inkscape:label>${PAYLOAD}</inkscape:label>` +
        DRAWS,
    ),
  );
  expect(shapes).toEqual([["path", { d: "M2 2 L22 22" }]]);
  expect(JSON.stringify(shapes)).not.toContain(PAYLOAD);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Nested `g` transforms are pushed down onto the shape, outermost first, then its own. */
export function runGroupTransformIsPushedDownOuterFirst(): void {
  const { shapes } = parse(
    svg('<g transform="translate(1 2)"><g transform="scale(2)"><rect x="0" y="0" width="1" height="1" transform="rotate(45)"/></g></g>'),
  );
  expect(shapes).toEqual([["rect", { x: "0", y: "0", width: "1", height: "1", transform: "translate(1 2) scale(2) rotate(45)" }]]);
}

/** An Inkscape-shaped file: root sizes in mm, namespaces, a layer group, editor metadata. */
export function runAnInkscapeFileParses(): void {
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    "<!-- Created with Inkscape (http://www.inkscape.org/) -->\n" +
    '<svg width="210mm" height="297mm" viewBox="0 0 210 297" version="1.1" id="svg5" ' +
    'inkscape:version="1.2" sodipodi:docname="inlet.svg" ' +
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
    'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
    'xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" ' +
    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cc="http://creativecommons.org/ns#" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '  <sodipodi:namedview id="namedview7" pagecolor="#ffffff" inkscape:zoom="0.5"/>\n' +
    '  <defs id="defs2"/>\n' +
    "  <metadata><rdf:RDF><cc:Work rdf:about=\"\"><dc:format>image/svg+xml</dc:format></cc:Work></rdf:RDF></metadata>\n" +
    '  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1" transform="translate(-10,-20)">\n' +
    '    <circle style="fill:none;stroke:#000000" id="c1" cx="105" cy="148.5" r="50"/>\n' +
    '    <path d="M 55,148.5\n      H 155" id="p1" style="stroke-width:2"/>\n' +
    '    <polygon points="1,2\t3,4 5,6"/>\n' +
    "  </g>\n" +
    "</svg>\n";
  const parsed = parse(xml);
  expect(parsed.viewBox).toEqual([0, 0, 210, 297]);
  expect(parsed.shapes).toEqual([
    ["circle", { cx: "105", cy: "148.5", r: "50", transform: "translate(-10,-20)" }],
    ["path", { d: "M 55,148.5 H 155", transform: "translate(-10,-20)" }],
    ["polygon", { points: "1,2 3,4 5,6", transform: "translate(-10,-20)" }],
  ]);
  assertAttrsWithinTheAllowlist(parsed.shapes);
}

export function runTheViewBoxIsATupleOfNumbers(): void {
  expect(parse(svg(DRAWS, "-1.5, 2 100 50")).viewBox).toEqual([-1.5, 2, 100, 50]);
}

export function runTagOrderIsKept(): void {
  const { shapes } = parse(
    svg('<rect x="0" y="0" width="1" height="1"/><circle cx="1" cy="1" r="1"/><line x1="0" y1="0" x2="1" y2="1"/>' +
      '<ellipse cx="1" cy="1" rx="1" ry="2"/><polyline points="0,0 1,1"/><path d="M0 0"/>'),
  );
  expect(shapes.map(([tag]) => tag)).toEqual(["rect", "circle", "line", "ellipse", "polyline", "path"]);
}

export function runAnAmpersandEntityInAnAttributeIsAccepted(): void {
  const { shapes } = parse(svg('<g aria-label="R &amp; D"><path d="M0 0 L1 1" data-note="a &amp; b"/></g>'));
  expect(shapes).toEqual([["path", { d: "M0 0 L1 1" }]]);
}

/** A widely-spaced transform is normalised into the stored grammar, not refused. */
export function runATransformIsNormalised(): void {
  const { shapes } = parse(svg('<path d="M0 0" transform=" matrix( 1 , 0 ,0,1, 2 ,3 )rotate(90) "/>'));
  expect(shapes).toEqual([["path", { d: "M0 0", transform: "matrix(1,0,0,1,2,3) rotate(90)" }]]);
}

// ---------------------------------------------------------------------------
// Review fixes — ReDoS, exponents, decision 6 inside metadata
// ---------------------------------------------------------------------------

/** Milliseconds `refusalOf(xml)` takes, and the refusal. */
function timedRefusal(xml: string): { refusal: SvgSymbolRefusal; ms: number } {
  const start = performance.now();
  const refusal = refusalOf(xml);
  return { refusal, ms: performance.now() - start };
}

/** A 64 KiB digit run in `cx` refuses at once: the old number regex held the event loop 26.8 s. */
export function runA64KiBNumberAttributeIsRefusedFast(): void {
  const xml = svg(`<circle cx="${"1".repeat(65_000)}x" cy="1" r="1"/>`);
  const { refusal, ms } = timedRefusal(xml);
  expect(refusal.message).toBe("Attribute cx of <circle> is not in the shape grammar");
  expect(ms, `the refusal took ${Math.round(ms)} ms`).toBeLessThan(100);
}

/** A 64 KiB digit run in the viewBox refuses at once. */
export function runA64KiBViewBoxNumberIsRefusedFast(): void {
  const { refusal, ms } = timedRefusal(svg(DRAWS, `0 0 24 ${"1".repeat(65_000)}x`));
  expect(refusal.message).toBe("Element <svg> needs a viewBox of four numbers");
  expect(ms, `the refusal took ${Math.round(ms)} ms`).toBeLessThan(100);
}

/**
 * `matrix(` + six 16-digit runs + `x` refuses at once. The ambiguous number took seconds here and
 * never ended at 40 digits; 16 keeps a regression red rather than a hung run.
 */
export function runALongMatrixTransformIsRefusedFast(): void {
  const transform = `matrix(${Array(6).fill("1".repeat(16)).join(",")}x`;
  const { refusal, ms } = timedRefusal(svg(`<path d="M0 0" transform="${transform}"/>`));
  expect(refusal.message).toBe("Attribute transform of <path> is not in the shape grammar");
  expect(ms, `the refusal took ${Math.round(ms)} ms`).toBeLessThan(100);
}

/** An exported file's exponents parse: `1.5e-4` in `d`, `1E-5` in `cx` (plan D1). */
export function runExponentsParse(): void {
  const { shapes } = parse(svg('<path d="m 0,0 1.5e-4,2"/><circle cx="1E-5" cy="+2" r="1"/>'));
  expect(shapes).toEqual([
    ["path", { d: "m 0,0 1.5e-4,2" }],
    ["circle", { cx: "1E-5", cy: "+2", r: "1" }],
  ]);
}

/** Decision 6: a `script` inside dropped `metadata` still refuses the file. */
export function runAScriptInsideMetadataIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<metadata><script>${PAYLOAD}</script></metadata>${DRAWS}`),
    "Element <script> is not allowed in a symbol",
  );
}

/** Decision 6: a `style` inside a `sodipodi:` element still refuses the file. */
export function runAStyleInsideSodipodiIsRefused(): void {
  assertRefusalNamesTheElementAndNotTheContent(
    svg(`<sodipodi:namedview><style>${PAYLOAD}</style></sodipodi:namedview>${DRAWS}`),
    "Element <style> is not allowed in a symbol",
  );
}
