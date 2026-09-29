// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  r1KeysAHyphenatedRoleByItsTokenName,
  r1ResolvesAccentFromTheLightBlock,
  r2AnEmptyReadThrowsNamingTheRole,
  r3AChannelAbove255Throws,
  r3AMalformedReadThrowsNamingTheRole,
  r4WithAlphaBuildsRgba,
  r4WithAlphaRejectsANonRgbString,
  r5CapitalisedDarkReadsLight,
  r5DarkAttributeReadsDark,
  r5MissingAttributeReadsLight,
} from "./theme.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom for R5. */
describe("F3.65c role resolver", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("R1 resolves accent from the light block as rgb(0, 166, 81)", () => {
    r1ResolvesAccentFromTheLightBlock();
  });

  it("R1 keys a hyphenated role by its token name (ink-muted, dark block)", () => {
    r1KeysAHyphenatedRoleByItsTokenName();
  });

  it("R2 an empty read throws naming the role (well)", () => {
    r2AnEmptyReadThrowsNamingTheRole();
  });

  it("R3 a malformed read throws naming the role (accent)", () => {
    r3AMalformedReadThrowsNamingTheRole();
  });

  it("R3 a channel above 255 throws naming the role (ink)", () => {
    r3AChannelAbove255Throws();
  });

  it("R4 withAlpha builds rgba from the parsed channels", () => {
    r4WithAlphaBuildsRgba();
  });

  it("R4 withAlpha rejects a string that is not rgb(r, g, b)", () => {
    r4WithAlphaRejectsANonRgbString();
  });

  it('R5 data-theme="dark" reads dark', () => {
    r5DarkAttributeReadsDark();
  });

  it('R5 data-theme="Dark" reads light', () => {
    r5CapitalisedDarkReadsLight();
  });

  it("R5 a missing data-theme reads light", () => {
    r5MissingAttributeReadsLight();
  });
});
