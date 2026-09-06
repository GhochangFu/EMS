import { expect } from "vitest";

import {
  EMPTY_BULK_EDIT_DRAFT,
  bulkEditProblems,
  draftToPatch,
  type BulkEditDraft,
} from "./asset-point-bulk-edit";

/**
 * `F2.7` / ADR 0056 decision 8 — the bulk editor's draft rules.
 *
 * The panel is wiring; the three-valued rule every field carries lives here:
 * **unticked = leave this row alone, ticked and empty = clear it back to the
 * template default, ticked with a value = write it.** The API spells the same
 * three states as absent / `null` / value (`assetPointBulkPatchSchema`), and a
 * draft that collapsed the first two would clear a column on every selected row
 * the moment somebody opened the panel and pressed Apply.
 *
 * Assertions live here; `asset-point-bulk-edit.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

/** The empty draft with the named fields ticked, so each case states only what it changes. */
function draftWith(changes: Partial<BulkEditDraft>): BulkEditDraft {
  return { ...EMPTY_BULK_EDIT_DRAFT, ...changes };
}

/** Case 1 — an unticked field is absent from the patch; nothing is sent by default. */
export function anUntickedFieldIsAbsentFromThePatch(): void {
  expect(draftToPatch(EMPTY_BULK_EDIT_DRAFT)).toEqual({});

  const patch = draftToPatch(draftWith({ scaleMultiplier: { set: true, value: "0.1" } }));
  expect(patch).toEqual({ scaleMultiplier: 0.1 });
  // Named explicitly: `toEqual` ignores a key whose value is `undefined`, and
  // "absent" here has to mean absent from `JSON.stringify` too.
  expect(Object.keys(patch)).toEqual(["scaleMultiplier"]);
}

/** Case 2 — a ticked field left empty clears the stored value back to the template default. */
export function aTickedEmptyFieldClearsTheStoredValue(): void {
  expect(
    draftToPatch(
      draftWith({
        unit: { set: true, value: "" },
        engMax: { set: true, value: "" },
        qualityPolicy: { set: true, value: "" },
      }),
    ),
  ).toEqual({ unit: null, engMax: null, qualityPolicy: null });

  // Whitespace is not a unit. The API would take "   " and store it.
  expect(draftToPatch(draftWith({ unit: { set: true, value: "  " } }))).toEqual({ unit: null });
  expect(draftToPatch(draftWith({ unit: { set: true, value: " kW " } }))).toEqual({ unit: "kW" });
}

/** Case 3 — `active` is a boolean, and `false` is a value, not an absence. */
export function activeFalseIsAValueNotAnAbsence(): void {
  expect(draftToPatch(draftWith({ active: { set: true, value: false } }))).toEqual({ active: false });
  expect(draftToPatch(draftWith({ active: { set: false, value: false } }))).toEqual({});
}

/** Case 4 — the three problems the panel refuses to send. */
export function theThreeProblemsAreNamed(): void {
  // (a) nothing set — the API answers 400 for the same reason, and an audit row
  // per selected row is what it is protecting.
  const empty = bulkEditProblems(EMPTY_BULK_EDIT_DRAFT);
  expect(empty).toHaveLength(1);
  expect(empty[0]).toContain("Nothing is set");

  // (b) a zero multiplier — ADR 0056 decision 2's bound, client-side too.
  const zero = bulkEditProblems(draftWith({ scaleMultiplier: { set: true, value: "0" } }));
  expect(zero.some((problem) => problem.includes("0"))).toBe(true);
  expect(zero.some((problem) => problem.toLowerCase().includes("multiplier"))).toBe(true);

  // (c) both bounds stated and inverted. Only both: one bound alone resolves
  // against each row's template default, which only the server can see
  // (correction 48's shape).
  const inverted = bulkEditProblems(
    draftWith({ engMin: { set: true, value: "100" }, engMax: { set: true, value: "10" } }),
  );
  expect(inverted.some((problem) => problem.toLowerCase().includes("below"))).toBe(true);
  expect(
    bulkEditProblems(draftWith({ engMin: { set: true, value: "100" } })),
  ).toHaveLength(0);
  expect(
    bulkEditProblems(
      draftWith({ engMin: { set: true, value: "10" }, engMax: { set: true, value: "100" } }),
    ),
  ).toHaveLength(0);
}

/** Case 5 — a ticked number field holding something that is not a number is refused, not sent. */
export function aFieldThatIsNotANumberIsRefused(): void {
  const problems = bulkEditProblems(draftWith({ engMin: { set: true, value: "abc" } }));
  expect(problems.some((problem) => problem.toLowerCase().includes("number"))).toBe(true);
}
