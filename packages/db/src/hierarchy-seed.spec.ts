import { createHash } from "node:crypto";

import { expect } from "vitest";

import { DOMAIN_RTU_SUFFIX, simRtuCode, simRtuDisplayName } from "./hierarchy-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.170` — `simRtuCode` bounds `bms.rtus.code` (`varchar(64)`) and
 * `simRtuDisplayName` bounds `bms.rtus.display_name` (`varchar(255)`) for
 * every ESKOM simulator RTU `ensureEskomDomainRtus` writes, whatever the
 * location's code or name length. `bms.locations.code` has no charset CHECK,
 * so both helpers count code points, and the cases below include astral-plane
 * codes and names.
 */

/** `n` code points, the unit Postgres counts a `varchar` length in. */
function codePoints(value: string): number {
  return Array.from(value).length;
}

/** The raw template is `8 + n + 1 + s`; `WATER` (5) fits at `n = 50`, overflows at 51. */
const X50 = "X".repeat(50);
const X51 = "X".repeat(51);

/** 64 characters — the admin API's maximum — long enough to overflow every suffix. */
const LONG64 = "F4170-" + "Y".repeat(58);

/** Two 64-character codes that agree on their first 63 characters. */
const Q64A = "Q".repeat(63) + "A";
const Q64B = "Q".repeat(63) + "B";

/** One code point, two UTF-16 code units. */
const ASTRAL = "\u{1F600}";

/** The name template is `n + 1 + D + 1 + 9`; `ENVIRONMENT` (11) fits at `n = 233`. */
const N233 = "N".repeat(233);
const N255 = "N".repeat(255);

/** The template the seed wrote before `F4.170`, for the fits-unchanged cases. */
function rawCode(locationCode: string, suffix: string): string {
  return `SIM-RTU-${locationCode}-${suffix}`;
}

function rawName(locationName: string, domain: string): string {
  return `${locationName} ${domain.toUpperCase()} Simulator`;
}

/** Case 1 — a seeded location's code is unchanged, so `ON CONFLICT` still finds its row. */
export function assertASeededCodeIsUnchanged(): void {
  expect(simRtuCode("RSMOC-WC", "ELEC")).toBe("SIM-RTU-RSMOC-WC-ELEC");
  expect(simRtuCode("CSMOC-GP", "WATER")).toBe("SIM-RTU-CSMOC-GP-WATER");
}

/**
 * Case 2 — `X50` + `WATER` sits exactly on the 64-character boundary and is
 * still the raw template.
 *
 * Mutation: the fit check's `<=` written `<`.
 */
export function assertTheBoundaryCodeFitsUnchanged(): void {
  const code = simRtuCode(X50, "WATER");
  expect(code, "a 64-code-point code must be the raw template").toBe(rawCode(X50, "WATER"));
  expect(codePoints(code)).toBe(64);
}

/**
 * Case 3 — one character past the boundary fills the bound exactly.
 *
 * Mutation: the cut width off by one either way.
 */
export function assertAnOverflowCodeFillsTheBoundExactly(): void {
  expect(codePoints(simRtuCode(X51, "WATER")), "an overflowing code must be exactly 64 code points").toBe(64);
}

/** Case 4 — the overflow shape: `SIM-RTU-<cut 46 - s>-<8 uppercase hex>-<suffix>`. */
export function assertTheOverflowCodeShape(): void {
  expect(simRtuCode(X51, "WATER")).toMatch(/^SIM-RTU-X{41}-[0-9A-F]{8}-WATER$/);
}

/** Case 5 — every suffix the seed uses stays inside the bound, each with its own cut. */
export function assertEverySuffixStaysInsideTheBound(): void {
  const suffixes = Object.values(DOMAIN_RTU_SUFFIX);
  expect(suffixes, "DOMAIN_RTU_SUFFIX must hold the five simulator domains").toHaveLength(5);
  const codes = suffixes.map((suffix) => {
    const code = simRtuCode(LONG64, suffix);
    expect(codePoints(code), `the ${suffix} code must be exactly 64 code points`).toBe(64);
    expect(code.endsWith(`-${suffix}`), `the ${suffix} code must end -${suffix}: ${code}`).toBe(true);
    const cut = LONG64.slice(0, 46 - suffix.length);
    expect(code.startsWith(`SIM-RTU-${cut}-`), `the ${suffix} code must start SIM-RTU-${cut}-: ${code}`).toBe(
      true,
    );
    return code;
  });
  expect(new Set(codes).size, "the five codes must be distinct").toBe(5);
}

/**
 * Case 6 — two long codes that agree up to the cut still differ.
 *
 * Mutation: the hash taken of the cut rather than of the full code.
 */
export function assertTwoLongCodesWithACommonPrefixDiffer(): void {
  expect(simRtuCode(Q64A, "ELEC")).not.toBe(simRtuCode(Q64B, "ELEC"));
}

/** Case 7 — the hash is the uppercase 8-hex SHA-256 prefix of the full raw location code. */
export function assertTheHashIsOfTheFullCode(): void {
  const expected = createHash("sha256").update(Q64A).digest("hex").toUpperCase().slice(0, 8);
  expect(simRtuCode(Q64A, "ELEC")).toContain(`-${expected}-`);
}

/** Case 8 — the same input gives the same code on every seed. */
export function assertTheCodeIsDeterministic(): void {
  expect(simRtuCode(LONG64, "HVAC")).toBe(simRtuCode(LONG64, "HVAC"));
}

/**
 * Case 9 — a code of 64 code points but 114 UTF-16 code units fits, and is
 * the raw template.
 *
 * Mutation: the fit check counting `.length` (code units).
 */
export function assertAnAstralCodeOnTheBoundaryFitsUnchanged(): void {
  const locationCode = ASTRAL.repeat(50);
  const code = simRtuCode(locationCode, "WATER");
  expect(code, "an astral code of 64 code points must be the raw template").toBe(rawCode(locationCode, "WATER"));
  expect(codePoints(code)).toBe(64);
  expect(code.length).toBe(114);
}

/**
 * Case 10 — the cut never splits a surrogate pair.
 *
 * Mutation: `slice()` on the string rather than on its code points.
 */
export function assertTheCodeCutNeverSplitsASurrogatePair(): void {
  const code = simRtuCode(ASTRAL.repeat(60), "WATER");
  expect(codePoints(code), "an astral overflow must be exactly 64 code points").toBe(64);
  expect(Array.from(code).filter((ch) => ch === ASTRAL), "the cut must keep 41 astral characters").toHaveLength(41);
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(code), "no lone surrogate").toBe(
    false,
  );
}

/** Case 11 — a seeded location's display name is unchanged. */
export function assertASeededNameIsUnchanged(): void {
  expect(simRtuDisplayName("RSMOC Western Cape", "electrical")).toBe("RSMOC Western Cape ELECTRICAL Simulator");
}

/**
 * Case 12 — `N233` + ` ENVIRONMENT Simulator` is exactly 255 and is the raw
 * template.
 *
 * Mutation: the budget one short. The fit check's `<=` written `<` is an
 * equivalent mutant here and survives: a name exactly on the budget, cut to
 * the budget, is the same string.
 */
export function assertTheBoundaryNameFitsUnchanged(): void {
  const name = simRtuDisplayName(N233, "environment");
  expect(name).toBe(rawName(N233, "environment"));
  expect(codePoints(name)).toBe(255);
}

/**
 * Case 13 — a 255-character name is cut to the budget the tail leaves; the
 * tail is kept whole.
 *
 * Mutations: the budget off by one; the tail cut instead of the head.
 */
export function assertALongNameIsCutToTheBound(): void {
  expect(simRtuDisplayName(N255, "environment")).toBe(`${N233} ENVIRONMENT Simulator`);
}

/** Case 14 — the name cut counts code points, never splitting a surrogate pair. */
export function assertTheNameCutNeverSplitsASurrogatePair(): void {
  expect(simRtuDisplayName(ASTRAL.repeat(240), "environment")).toBe(
    `${ASTRAL.repeat(233)} ENVIRONMENT Simulator`,
  );
}

/**
 * Case 15 — the tail keeps the uppercased domain, and the budget follows the
 * domain's length.
 *
 * Mutation: `toUpperCase()` dropped.
 */
export function assertTheTailKeepsTheUppercasedDomain(): void {
  const name = simRtuDisplayName(N255, "it");
  expect(name.endsWith(" IT Simulator"), `the name must end " IT Simulator": ...${name.slice(-20)}`).toBe(true);
  expect(codePoints(name)).toBe(255);
}
