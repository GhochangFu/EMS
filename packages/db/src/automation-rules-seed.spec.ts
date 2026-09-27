import { createHash } from "node:crypto";

import { expect } from "vitest";

import { ESKOM_LADDER_RULES, ladderRuleCode } from "./automation-rules-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.129` — `ladderRuleCode` bounds `bms.automation_rules.code`
 * (`varchar(64)`) for every ESKOM ladder rule, whatever the asset code's
 * length. Fixtures below are all ASCII (migration `0070`'s charset check),
 * so `slice()` on code units is exact (the `F4.104` surrogate lesson does
 * not apply — the plan's own header states this).
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
 * D1 — the hash is of the RAW asset code, before the `-` → `_` fold, so two
 * long codes that share every character up to the cut still diverge: the
 * divergent tail (past the cut) still changes the hash of the full code.
 */
export function assertTwoLongCodesWithACommonPrefixDiffer(): void {
  expect(ladderRuleCode(P61A, "PF_LOW")).not.toBe(ladderRuleCode(P61B, "PF_LOW"));
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
 * of `sha256` of the FULL raw asset code (D1) — `upsertRuleByCode` compares
 * `.toUpperCase()`, so a lowercase hash segment would never match itself on
 * a re-seed.
 */
export function assertTheHashIsOfTheFullCode(): void {
  const code = ladderRuleCode(P61A, "PF_LOW");
  const expectedHash = createHash("sha256").update(P61A).digest("hex").toUpperCase().slice(0, 8);
  expect(code).toContain(expectedHash);
}
