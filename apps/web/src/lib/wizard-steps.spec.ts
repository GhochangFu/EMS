import { expect } from "vitest";

import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { applyFill, openWizardKey, wizardStepsOf } from "./wizard-steps";

/**
 * `F4.245` / ADR 0099 Amendment 4 — the key that names one open wizard's
 * record, and the page-fixed fields a fill never sets. `applyFill`'s other
 * cases stay in `copilot-card-logic.spec.ts`. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const entry = (id: string): CatalogEntry => catalogEntry(id) as CatalogEntry;

export function theKeyIsTheEntryAndItsPath(): void {
  expect(openWizardKey(entry("dashboard.update"), { id: A })).toBe(`dashboard.update /api/v1/dashboards/${A}`);
}

/** Critique C5: two entries share one path; the key keeps them apart. Mutation: key on the path alone → equal. */
export function twoEntriesOfOnePathHaveTwoKeys(): void {
  const setRole = openWizardKey(entry("assetGroup.member.setRole"), { id: A });
  const remove = openWizardKey(entry("assetGroup.member.remove"), { id: A });
  expect(setRole).not.toBeNull();
  expect(setRole).not.toBe(remove);
}

export function aCreateHasAKeyWithNoParams(): void {
  expect(openWizardKey(entry("dashboard.create"), {})).toBe("dashboard.create /api/v1/dashboards");
}

/** Critique C7: a wrong shape is `null` (the shell shows an alert), never a throw at render. */
export function aMissingParamHasNoKey(): void {
  expect(openWizardKey(entry("dashboard.update"), {})).toBeNull();
}

/** Mutation: drop the extra-key check — a create given an id gets a key. */
export function anExtraParamHasNoKey(): void {
  expect(openWizardKey(entry("dashboard.create"), { id: A })).toBeNull();
}

/** Mutation: drop the value parse — a non-uuid id gets a key. */
export function aValueTheEntryRefusesHasNoKey(): void {
  expect(openWizardKey(entry("dashboard.update"), { id: "not-a-uuid" })).toBeNull();
}

/** Two records of one entry have two keys. */
export function twoRecordsHaveTwoKeys(): void {
  expect(openWizardKey(entry("dashboard.update"), { id: A })).not.toBe(openWizardKey(entry("dashboard.update"), { id: B }));
}

/** Critique C2: a field the page fixes is never set by a fill. Mutation: ignore `fixed` → the organization is overwritten. */
export function aFillNeverSetsAPageFixedField(): void {
  const create = entry("dashboardTemplate.importStock");
  const steps = wizardStepsOf(create);
  const field = steps[0]?.fields[0] as string;
  const filled = applyFill(
    create.id,
    steps,
    { [field]: A, name: "kept" },
    { catalogId: create.id, params: { code: "x" }, stepId: steps[0]?.id as string, values: { [field]: B, other: "y" } },
    [field],
  );
  expect(filled).toBeNull();
}

/** Review C2. Mutation: return the copy when no field was applied — a no-op fill reads as a change. */
export function aFillThatSetsNoFieldIsNull(): void {
  const create = entry("dashboard.create");
  const steps = wizardStepsOf(create);
  expect(applyFill(create.id, steps, { name: "kept" }, { catalogId: create.id, params: {}, stepId: "basics", values: { notAField: "x" } })).toBeNull();
}

/** The adjacent positive: a page-fixed field beside a free one — only the free one is set. */
export function aFillSetsOnlyTheFreeFieldsBesideAFixedOne(): void {
  const create = entry("dashboard.create");
  const steps = wizardStepsOf(create);
  const filled = applyFill(create.id, steps, { name: "Fixed" }, { catalogId: create.id, params: {}, stepId: "basics", values: { name: "X", slug: "x" } }, ["name"]);
  expect(filled).toEqual({ name: "Fixed", slug: "x" });
}

/** The adjacent positive: without `fixed`, the same fill sets the field. */
export function aFillSetsAFieldThePageDoesNotFix(): void {
  const create = entry("dashboardTemplate.importStock");
  const steps = wizardStepsOf(create);
  const field = steps[0]?.fields[0] as string;
  const filled = applyFill(create.id, steps, { [field]: A }, { catalogId: create.id, params: { code: "x" }, stepId: steps[0]?.id as string, values: { [field]: B } });
  expect(filled).toEqual({ [field]: B });
}
