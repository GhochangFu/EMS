import { expect } from "vitest";

import { MimicSymbolLibrariesService } from "./mimic-symbol-libraries.service";

/**
 * `F3.32f` slice 3 review fix — the upload's default label is cut at 64 UTF-16 units on a
 * code-point boundary. Assertions live here; `mimic-symbol-libraries.service.test.ts` is the
 * Vitest entry point (ADR 0014), one `it()` per claim. No database: `labelOf` is pure.
 *
 * Mutation that reddens the first claim: `labelOf` back to `(label || stem || …).slice(0, 64)`.
 */

const KEY = "org.plant:inlet";

/** 63 ASCII characters then an emoji: the old `.slice(0, 64)` left a lone high surrogate. */
export function aStemIsNotCutInsideASurrogatePair(): void {
  const stem = `${"a".repeat(63)}\u{1F600}tail`;
  const label = MimicSymbolLibrariesService.labelOf(undefined, stem, KEY);
  expect(label).toBe("a".repeat(63));
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label)).toBe(false);
}

/** An emoji that fits is kept whole, and the label stays within the PATCH schema's `.max(64)`. */
export function anEmojiThatFitsIsKept(): void {
  const stem = `${"a".repeat(62)}\u{1F600}tail`;
  const label = MimicSymbolLibrariesService.labelOf(undefined, stem, KEY);
  expect(label).toBe(`${"a".repeat(62)}\u{1F600}`);
  expect(label.length).toBe(64);
}

/** The stated label wins; with neither label nor stem the key's name is the label. */
export function theStatedLabelThenTheStemThenTheKeyName(): void {
  expect(MimicSymbolLibrariesService.labelOf("Inlet screen", "inlet-v2", KEY)).toBe("Inlet screen");
  expect(MimicSymbolLibrariesService.labelOf(undefined, "inlet-v2", KEY)).toBe("inlet-v2");
  expect(MimicSymbolLibrariesService.labelOf("", "", KEY)).toBe("inlet");
}
