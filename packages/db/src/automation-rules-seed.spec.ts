import { createHash } from "node:crypto";

import { expect } from "vitest";

import { ESKOM_LADDER_RULES, ladderRuleCode, ladderRuleName } from "./automation-rules-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.129` — `ladderRuleCode` bounds `bms.automation_rules.code`
 * (`varchar(64)`) for every ESKOM ladder rule, whatever the asset code's
 * length. The code fixtures below are all ASCII (migration `0070`'s charset
 * check), so `slice()` on code units is exact there. `ladderRuleName` bounds
 * `bms.automation_rules.name` (`varchar(255)`); asset names are free text, so
 * its cases include an astral-plane name.
 */

/** `n` `"A"` characters — used to sit exactly at, one below, and past the boundary. */
const A40 = "A".repeat(40);
const A41 = "A".repeat(41);
const A42 = "A".repeat(42);

/** 60 characters, long enough to overflow every one of the five suffixes. */
const LONG60 = "F4129-" + "X".repeat(54);

/** 60 `"P"` characters, and two 61-character codes sharing that 60-character prefix. */
const P60 = "P".repeat(60);
const P61A = P60 + "A";
const P61B = P60 + "B";

/**
 * The short path: an asset code that fits does not change by one byte —
 * same template `seedEskomLadderRules` used before this item, `-` folded to
 * `_`.
 */
export function assertAShortCodeIsUnchanged(): void {
  expect(ladderRuleCode("ESK-MANUAL-01", "PF_LOW")).toBe("ESKOM_ESK_MANUAL_01_PF_LOW");
  expect(ladderRuleCode("UPS-A", "DEMAND_HIGH")).toBe("ESKOM_UPS_A_DEMAND_HIGH");
}

/**
 * The template is `ESKOM_` (6) + the folded code (`n`) + `_` (1) + the
 * suffix (`s`) — `7 + n + s` long. `A41` + `VOLTAGE_CRITICAL` (16) sits
 * exactly at the 64-character boundary and must still be the raw template.
 *
 * Mutation: reddens a `<=` in the helper's fits-unchanged check that was
 * mistakenly written `<`.
 */
export function assertTheBoundaryFitsUnchanged(): void {
  const code = ladderRuleCode(A41, "VOLTAGE_CRITICAL");
  expect(code).toBe(`ESKOM_${A41}_VOLTAGE_CRITICAL`);
  expect(code).toHaveLength(64);
}

/** One character below the boundary: still the raw template, length 63. */
export function assertOneBelowTheBoundaryFitsUnchanged(): void {
  const code = ladderRuleCode(A40, "VOLTAGE_CRITICAL");
  expect(code).toBe(`ESKOM_${A40}_VOLTAGE_CRITICAL`);
  expect(code).toHaveLength(63);
}

/**
 * One character past the boundary (`A42`): D2 — the overflow fills 64
 * exactly rather than cutting further than it has to.
 */
export function assertAnOverflowFillsTheBoundExactly(): void {
  expect(ladderRuleCode(A42, "VOLTAGE_CRITICAL")).toHaveLength(64);
}

/**
 * The overflow shape: `ESKOM_<cut>_<8 hex>_<suffix>`. For `VOLTAGE_CRITICAL`
 * (`s = 16`), `k = 48 - s = 32`, so the cut is exactly 32 `A`s.
 */
export function assertTheOverflowShape(): void {
  expect(ladderRuleCode(A42, "VOLTAGE_CRITICAL")).toMatch(
    /^ESKOM_A{32}_[0-9A-F]{8}_VOLTAGE_CRITICAL$/,
  );
}

/** The cut is a pure function of its inputs: the same call twice agrees. */
export function assertTheCutIsDeterministic(): void {
  expect(ladderRuleCode(LONG60, "PF_LOW")).toBe(ladderRuleCode(LONG60, "PF_LOW"));
}

/**
 * D1, the "full" half — two long codes that share every character up to the
 * cut still diverge: the tail past the cut still changes the hash of the full
 * code. Mutation: hashing `cut` instead of the asset code reddens this.
 */
export function assertTwoLongCodesWithACommonPrefixDiffer(): void {
  expect(ladderRuleCode(P61A, "PF_LOW")).not.toBe(ladderRuleCode(P61B, "PF_LOW"));
}

/**
 * D1, the "raw" half — two long codes that differ only by `-` against `_`
 * fold to the same string, so only a hash of the unfolded code keeps them
 * apart. Mutation: hashing `folded` instead of `assetCode` reddens this, and
 * no other case (their fixtures hold no `-` where the hash is compared).
 */
export function assertAHyphenAndAnUnderscoreDiffer(): void {
  const hyphen = "Q".repeat(30) + "-" + "Q".repeat(30);
  const underscore = "Q".repeat(30) + "_" + "Q".repeat(30);
  expect(ladderRuleCode(hyphen, "PF_LOW")).not.toBe(ladderRuleCode(underscore, "PF_LOW"));
}

/**
 * `ESKOM_LADDER_RULES` itself (D3), so this iterates the five real suffixes
 * rather than restating them. Every rule stays inside the 64-character bound
 * for the same long asset code, and the five resulting codes are distinct
 * (they differ by suffix, inside the same hash and cut).
 */
export function assertEverySuffixStaysInsideTheBound(): void {
  expect(ESKOM_LADDER_RULES).toHaveLength(5);
  const folded = LONG60.replaceAll("-", "_");
  const codes = ESKOM_LADDER_RULES.map((rule) => {
    const code = ladderRuleCode(LONG60, rule.suffix);
    const k = 48 - rule.suffix.length;
    expect(code).toHaveLength(64);
    expect(code.endsWith(`_${rule.suffix}`), `${code} must end _${rule.suffix}`).toBe(true);
    expect(
      code.startsWith(`ESKOM_${folded.slice(0, k)}_`),
      `${code} must start ESKOM_${folded.slice(0, k)}_`,
    ).toBe(true);
    return code;
  });
  expect(new Set(codes).size).toBe(5);
}

/**
 * The hash segment is the first `LADDER_HASH_WIDTH` uppercase hex characters
 * of `sha256` of the full asset code. Uppercase is the case `upsertRuleByCode`
 * upper-cases its stored side to; see the helper's docblock for when a
 * re-seed reaches that compare.
 */
export function assertTheHashIsOfTheFullCode(): void {
  const code = ladderRuleCode(P61A, "PF_LOW");
  const expectedHash = createHash("sha256").update(P61A).digest("hex").toUpperCase().slice(0, 8);
  expect(code).toContain(expectedHash);
}

/** The longest ladder name suffix, `"L1 voltage critical"` (19 characters). */
const LONGEST_NAME_SUFFIX = "L1 voltage critical";

/** How many code points a single `Array.from` sees — Postgres' `varchar` count. */
function codePoints(value: string): number {
  return Array.from(value).length;
}

/** A name that fits comes back as `${assetName} ${nameSuffix}`, unchanged. */
export function assertAShortNameIsUnchanged(): void {
  expect(ladderRuleName("UPS-A feeder", "demand high")).toBe("UPS-A feeder demand high");
}

/**
 * The boundary: a 235-character asset name plus `" "` and the 19-character
 * suffix is exactly 255, and must come back unchanged. Mutation: `<=` written
 * `<` in the helper cuts one character too many and reddens this.
 */
export function assertANameOnTheBoundaryIsUnchanged(): void {
  const assetName = "N".repeat(235);
  const name = ladderRuleName(assetName, LONGEST_NAME_SUFFIX);
  expect(name).toBe(`${assetName} ${LONGEST_NAME_SUFFIX}`);
  expect(codePoints(name)).toBe(255);
}

/**
 * A 255-character asset name (the admin API's maximum) overflows; the rule
 * name is cut to exactly 255 and keeps the whole suffix. Mutation: returning
 * the raw template (275) reddens this, as does cutting the suffix instead.
 */
export function assertALongNameIsCutToTheBound(): void {
  const name = ladderRuleName("N".repeat(255), LONGEST_NAME_SUFFIX);
  expect(codePoints(name)).toBe(255);
  expect(name.endsWith(` ${LONGEST_NAME_SUFFIX}`)).toBe(true);
}

/**
 * The cut counts code points, so an astral-plane name is cut between
 * characters, never inside a surrogate pair. `ASTRAL` (U+1F600) is two
 * UTF-16 code units and one character. Mutation: a code-unit
 * `assetName.slice(0, budget)` keeps 117 whole characters and a lone high
 * surrogate, and reddens this.
 */
export function assertTheNameCutNeverSplitsASurrogatePair(): void {
  const ASTRAL = "\u{1F600}";
  const name = ladderRuleName(ASTRAL.repeat(240), LONGEST_NAME_SUFFIX);
  expect(codePoints(name)).toBe(255);
  expect(name).toBe(`${ASTRAL.repeat(235)} ${LONGEST_NAME_SUFFIX}`);
}
