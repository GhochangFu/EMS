import { expect } from "vitest";

import { canonicalJson } from "./canonical-json";

/**
 * `F3.85` PR 4 / drafter choice 5 — the canonical body serialisation. The
 * fixed vector's canonical form is written as a literal here; its SHA-256 is
 * written as a literal in `apps/api/src/copilot/body-hash.spec.ts` and in
 * `apps/web/src/lib/copilot-body-hash.spec.ts`, which hash with their own
 * runtime's SHA-256 (this package has no Node or DOM types). A change to the
 * form on one side alone turns that side red. Vitest entry point: the sibling
 * `.test.ts`.
 */
export const VECTOR = { b: [{ z: 1, a: null }], a: "x" };
export const VECTOR_CANONICAL = '{"a":"x","b":[{"a":null,"z":1}]}';

export function theFixedVectorIsCanonical(): void {
  expect(canonicalJson(VECTOR)).toBe(VECTOR_CANONICAL);
}

export function keyOrderDoesNotChangeTheForm(): void {
  expect(canonicalJson({ a: "x", b: [{ a: null, z: 1 }] })).toBe(VECTOR_CANONICAL);
  // Array order is data, not form: it is kept.
  expect(canonicalJson([2, 1])).toBe("[2,1]");
}

/** A bodyless catalog entry's canonical body is `{}` (plan §6.4). */
export function theEmptyBodyIsBraces(): void {
  expect(canonicalJson({})).toBe("{}");
}

/** The JSON image first: what the wire carries is what is hashed. */
export function theJsonImageIsTakenFirst(): void {
  expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  expect(canonicalJson({ at: new Date("2026-10-10T00:00:00.000Z") })).toBe('{"at":"2026-10-10T00:00:00.000Z"}');
  expect(canonicalJson([undefined])).toBe("[null]");
  expect(canonicalJson(undefined)).toBe("null");
  expect(canonicalJson("a\"b")).toBe('"a\\"b"');
}

export function nestedObjectsAreSortedToo(): void {
  expect(canonicalJson({ z: { y: 1, x: [{ d: 1, c: 2 }] } })).toBe('{"z":{"x":[{"c":2,"d":1}],"y":1}}');
}
