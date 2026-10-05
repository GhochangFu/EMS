import { expect } from "vitest";

import { boldSegments } from "./bold-segments";

/**
 * `F4.198` — the assistant's `**bold**` markers, as data. One `export` per
 * claim so the `.test.ts` wrapper holds one `it()` each (ADR 0014).
 */

export function aPairedMarkerMakesTheMiddleBold(): void {
  expect(boldSegments("use the **Credentials** field")).toEqual([
    { text: "use the ", bold: false },
    { text: "Credentials", bold: true },
    { text: " field", bold: false },
  ]);
}

export function anUnpairedMarkerStaysLiteral(): void {
  expect(boldSegments("a ** b")).toEqual([{ text: "a ** b", bold: false }]);
}

export function aTrailingUnpairedMarkerStaysLiteralAfterAPair(): void {
  expect(boldSegments("**a** b **c")).toEqual([
    { text: "a", bold: true },
    { text: " b **c", bold: false },
  ]);
}

export function htmlStaysPlainText(): void {
  expect(boldSegments("<b>x</b> **y**")).toEqual([
    { text: "<b>x</b> ", bold: false },
    { text: "y", bold: true },
  ]);
}

export function emptySegmentsAreDropped(): void {
  expect(boldSegments("")).toEqual([]);
  expect(boldSegments("**a****b**")).toEqual([
    { text: "a", bold: true },
    { text: "b", bold: true },
  ]);
}
