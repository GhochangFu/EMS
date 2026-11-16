import { DASHBOARD_SLUG_MAX, DASHBOARD_SLUG_PATTERN, isDashboardSlug } from "./dashboard-slug";

/**
 * `E4.2` PR 2 sweep — `isDashboardSlug` mirrors
 * `.min(2).max(64).regex(/^[a-z0-9-]+$/)`. Assertions live here;
 * `dashboard-slug.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The shape both write doors accept. */
export function acceptsALowercaseHyphenatedSlug(): void {
  assert(isDashboardSlug("sustainability-overview-2"), "a lowercase hyphenated slug is valid");
}

/** The exact value that made an administrator fill the whole form and get a 400. */
export function refusesAName(): void {
  assert(!isDashboardSlug("Sustainability Overview"), "a capital and a space are both refused");
}

/** `.min(2)` — one character is refused, and the two-character control beside it
 * proves the bound rather than a blanket refusal. */
export function refusesASingleCharacter(): void {
  assert(!isDashboardSlug("a"), "one character is below the minimum");
  assert(isDashboardSlug("ab"), "the positive control — two characters is the minimum");
}

/** `.max(64)` — the boundary and the value one past it. */
export function refusesMoreThanSixtyFourCharacters(): void {
  assert(isDashboardSlug("a".repeat(DASHBOARD_SLUG_MAX)), "the positive control — 64 is accepted");
  assert(!isDashboardSlug("a".repeat(DASHBOARD_SLUG_MAX + 1)), "65 characters is above the maximum");
}

/**
 * `F4.380` (the owner's AWS check, 2026-11-16) — Chrome compiles an `<input pattern>` as
 * `^(?:pattern)$` with the `v` flag, where a bare `-` at the end of a class is a syntax error;
 * the browser then logged "Invalid character class" and checked nothing. The pattern must compile
 * under `v` and still mean the server's rule.
 */
export function thePatternCompilesWithTheVFlagAsChromeDoes(): void {
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(`^(?:${DASHBOARD_SLUG_PATTERN})$`, "v");
  } catch (error) {
    throw new Error(`DASHBOARD_SLUG_PATTERN does not compile with the v flag: ${String(error)}`);
  }
  assert(compiled.test("sustainability-overview-2"), "the v-flag pattern accepts a hyphenated slug");
  assert(!compiled.test("Sustainability Overview"), "the v-flag pattern refuses a capital and a space");
  assert(!compiled.test("a_b"), "the v-flag pattern refuses an underscore");
}
