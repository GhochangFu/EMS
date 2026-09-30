import { cleanup, render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { MimicOrgSymbolDto, MimicShape } from "@bms/shared";

import { MimicGlyph } from "./mimic-glyphs";
import glyphSource from "./mimic-glyphs.tsx?raw";

/**
 * `F3.32f` slice 3 (ADR 0086 decision 6, "how it draws") — an uploaded organization symbol.
 *
 * The renderer draws a stored shape list by copying only the allowlisted attribute keys into React
 * props, never by spreading the stored object. One exported claim per `it()` in the `.test.tsx`
 * wrapper (ADR 0014).
 */

const ORG_KEY = "org.plant:inlet" as const;

function symbol(over: Partial<MimicOrgSymbolDto> = {}): MimicOrgSymbolDto {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    libraryId: "66666666-6666-4666-8666-666666666666",
    key: ORG_KEY,
    label: "Inlet screen",
    group: "water",
    style: "stroke",
    viewBox: [0, 0, 100, 50],
    shapes: [
      ["rect", { x: "10", y: "10", width: "80", height: "30" }],
      ["path", { d: "M0 0L100 50" }],
    ],
    active: true,
    sourceFilename: "inlet.svg",
    sha256: "c".repeat(64),
    updatedAt: "2026-09-30T00:00:00.000Z",
    ...over,
  };
}

function draw(orgSymbol: MimicOrgSymbolDto | null, className = "stroke-info"): HTMLElement {
  render(
    <svg>
      <MimicGlyph kind={ORG_KEY} x={10} y={20} size={60} className={className} orgSymbol={orgSymbol} />
    </svg>,
  );
  return screen.getByTestId("mimic-glyph");
}

/** G1 — an `org.` kind with its symbol draws `data-glyph-source="org"` and one element per shape, in tag order. */
export function anOrgSymbolDrawsOneElementPerShape(): void {
  const glyph = draw(symbol());
  expect(glyph.getAttribute("data-glyph-source")).toBe("org");
  expect(glyph.getAttribute("data-glyph-fallback")).toBeNull();
  expect(Array.from(glyph.children).map((el) => el.tagName.toLowerCase())).toEqual(["rect", "path"]);
}

/** G2 — the wrapper scales the longer side to `size` and centres the shorter; the stroke scales with it (R6). */
export function anOrgSymbolIsScaledAndCentredByItsViewBox(): void {
  const glyph = draw(symbol());
  expect(glyph.getAttribute("transform")).toBe("translate(10 20) scale(0.6) translate(0 25)");
  expect(glyph.getAttribute("stroke-width")).toBe("6.25");
  expect(glyph.getAttribute("fill")).toBe("none");
  expect(glyph.getAttribute("class")).toBe("stroke-info");
}

/** G3 — a `fill` symbol draws with no stroke, the marker, and the mapped fill class. */
export function aFillOrgSymbolDrawsWithTheFillClass(): void {
  const glyph = draw(symbol({ style: "fill" }), "stroke-accent");
  expect(glyph.getAttribute("stroke")).toBe("none");
  expect(glyph.getAttribute("data-glyph-style")).toBe("fill");
  expect(glyph.getAttribute("class")).toBe("fill-accent");
  expect(glyph.getAttribute("data-glyph-source")).toBe("org");
}

/** G4 — a stored attrs object carrying an extra key never reaches the DOM: keys are copied, not spread. */
export function anExtraStoredKeyNeverReachesTheDom(): void {
  const hostile = { d: "M0 0", onload: "x", style: "fill:red" } as unknown as MimicShape[1];
  const glyph = draw(symbol({ shapes: [["path", hostile]] }));
  const path = glyph.querySelector("path");
  expect(path?.getAttribute("d")).toBe("M0 0");
  expect(path?.getAttributeNames()).toEqual(["d"]);
}

/** G5 — an `org.` kind with no symbol draws the marked fallback and does not throw. */
export function anOrgKindWithNoSymbolDrawsTheFallback(): void {
  expect(() => draw(null)).not.toThrow();
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBe("true");
  expect(glyph.getAttribute("data-glyph-source")).toBeNull();
}

/** G6 — a vendored library key still draws from the bundle: no fallback, no org marker. */
export function aVendoredKeyStillDraws(): void {
  render(
    <svg>
      <MimicGlyph kind="tabler:bolt" x={0} y={0} size={24} className="stroke-info" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBeNull();
  expect(glyph.getAttribute("data-glyph-source")).toBeNull();
  expect(glyph.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse").length).toBeGreaterThan(0);
  cleanup();
}

/** Every `createElement(` call site in `text` whose argument list holds a `...` spread. */
export function spreadsInCreateElementCalls(text: string): string[] {
  const found: string[] = [];
  let from = text.indexOf("createElement(");
  while (from !== -1) {
    let depth = 0;
    let end = from + "createElement".length;
    for (; end < text.length; end += 1) {
      if (text[end] === "(") depth += 1;
      if (text[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const call = text.slice(from, end + 1);
    if (call.includes("...")) found.push(call);
    from = text.indexOf("createElement(", from + 1);
  }
  return found;
}

/** G7 — no `createElement(` call in the glyph file spreads an object; a planted spread is caught. */
export function noCreateElementCallSpreadsAStoredObject(): void {
  const text = glyphSource;
  expect(text).toContain("createElement(");
  expect(spreadsInCreateElementCalls("createElement(tag, { ...attrs })")).toHaveLength(1);
  expect(spreadsInCreateElementCalls(text)).toEqual([]);
}
