import { DASHBOARD_SLUG_MAX, isDashboardSlug } from "./dashboard-slug";

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
