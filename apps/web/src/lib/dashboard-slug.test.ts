import { describe, it } from "vitest";

import {
  acceptsALowercaseHyphenatedSlug,
  refusesAName,
  refusesASingleCharacter,
  refusesMoreThanSixtyFourCharacters,
} from "./dashboard-slug.spec";

/** Vitest entry point for `dashboard-slug.spec.ts` (ADR 0014). */
describe("E4.2 sweep — the dashboard slug rule on the client", () => {
  it("accepts a lowercase hyphenated slug", () => {
    acceptsALowercaseHyphenatedSlug();
  });

  it("refuses a typed name", () => {
    refusesAName();
  });

  it("refuses a single character", () => {
    refusesASingleCharacter();
  });

  it("refuses more than sixty-four characters", () => {
    refusesMoreThanSixtyFourCharacters();
  });
});
