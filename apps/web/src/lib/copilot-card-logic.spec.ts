import { expect } from "vitest";
import { COPILOT_CATALOG, catalogEntry } from "@bms/shared/copilot";

import { CHANGE_VALUE_MAX, changeRows, fieldLabel, formatChangeValue } from "./copilot-diff";
import { INVALIDATED_ENTRIES, invalidationKeysFor } from "./copilot-invalidations";
import {
  applyFill,
  bodyProblems,
  guardWizardLeave,
  nextStepId,
  previousStepId,
  REVIEW_STEP,
  stepProblems,
  wizardBody,
  wizardStepsOf,
} from "./wizard-steps";

/**
 * `F3.85` PR 8 (plan §10.3) — the pure logic behind the Confirm card and the
 * wizard shell: the invalidation map, the card's rows, and the steps.
 * Vitest entry point: `copilot-card-logic.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";

const entry = (id: string) => {
  const found = catalogEntry(id);
  if (!found) throw new Error(id);
  return found;
};

/** Every catalog entry invalidates at least one query, and no row names an entry that does not exist. */
export function everyEntryHasInvalidations(): void {
  for (const catalogEntryItem of COPILOT_CATALOG) {
    expect(invalidationKeysFor(catalogEntryItem.id).length, catalogEntryItem.id).toBeGreaterThan(0);
  }
  expect([...INVALIDATED_ENTRIES].sort()).toEqual(COPILOT_CATALOG.map((e) => e.id).sort());
  expect(invalidationKeysFor("dashboard.create")).toEqual([["dashboards"]]);
  expect(invalidationKeysFor("dashboardTemplate.instantiate")).toContainEqual(["dashboards"]);
  expect(invalidationKeysFor("nope")).toEqual([]);
  // `F3.86` PR 3d: both site-view writes re-resolve the site page; the copy also makes a dashboard.
  expect(invalidationKeysFor("location.controlRoomView.set")).toEqual([["admin", "locations"], ["control-room", "site-view"]]);
  expect(invalidationKeysFor("location.siteLayout.make")).toContainEqual(["control-room", "site-view"]);
  expect(invalidationKeysFor("location.siteLayout.make")).toContainEqual(["dashboards"]);
}

/**
 * `F3.86` PR 3c — a confirmed asset-group or point-key change re-reads the
 * page's own lists: every key `asset-groups-page.tsx` reads (the groups, and
 * a group's members) starts with `["admin","asset-groups"]`, and every
 * point-key read (the page, the asset-point and manual-reading pickers) with
 * `["admin","point-keys"]`.
 */
export function theAssetGroupAndPointKeyEntriesInvalidateTheirPages(): void {
  for (const id of [
    "assetGroup.create",
    "assetGroup.update",
    "assetGroup.member.add",
    "assetGroup.member.setRole",
    "assetGroup.member.remove",
  ]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "asset-groups"]]);
  }
  for (const id of ["pointKey.create", "pointKey.update", "pointKey.deactivate", "pointKey.reactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "point-keys"]]);
  }
}

export function aCreateHasNoBeforeValues(): void {
  const rows = changeRows({ name: "Main", slug: "main", description: null }, null);
  expect(rows).toEqual([
    { field: "name", after: "Main", changed: true },
    { field: "slug", after: "main", changed: true },
    { field: "description", after: "—", changed: true },
  ]);
}

/** An edit shows the record's value now beside the value sent, and marks the fields it does not alter. */
export function anEditShowsBeforeAndAfter(): void {
  const rows = changeRows({ name: "New", slug: "same" }, { name: "Old", slug: "same", description: "x" });
  expect(rows).toEqual([
    { field: "name", after: "New", before: "Old", changed: true },
    { field: "slug", after: "same", before: "same", changed: false },
  ]);
}

export function longAndStructuredValuesAreShortened(): void {
  expect(formatChangeValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
  const long = formatChangeValue("x".repeat(500));
  expect(long).toHaveLength(CHANGE_VALUE_MAX);
  expect(long.endsWith("…")).toBe(true);
  expect(formatChangeValue(undefined)).toBe("—");
  expect(fieldLabel("assetGroupId")).toBe("Asset group id");
}

/** Ruling Q6: every entry ends with Review; a bodyless entry is Review alone. */
export function everyWizardEndsWithReview(): void {
  expect(wizardStepsOf(entry("dashboardTemplate.publish"))).toEqual([REVIEW_STEP]);
  const create = wizardStepsOf(entry("dashboard.create")).map((s) => s.id);
  expect(create).toEqual(["basics", "scope", "review"]);
  expect(nextStepId(wizardStepsOf(entry("dashboard.create")), "basics")).toBe("scope");
  expect(nextStepId(wizardStepsOf(entry("dashboard.create")), "review")).toBe("review");
  expect(previousStepId(wizardStepsOf(entry("dashboard.create")), "basics")).toBe("basics");
  expect(previousStepId(wizardStepsOf(entry("dashboard.create")), "review")).toBe("scope");
}

/** A step is checked on its own fields only; the whole body, refinements included, at Review. */
export function aStepIsCheckedAloneAndTheBodyAtReview(): void {
  const create = entry("dashboard.create");
  const [basics, scope] = wizardStepsOf(create);
  if (!basics || !scope) throw new Error("steps");
  expect(stepProblems(create, basics, { name: "Main", slug: "Bad Slug" })).toHaveLength(1);
  expect(stepProblems(create, basics, { name: "Main", slug: "main", organizationId: "not-checked-here" })).toEqual([]);
  expect(stepProblems(create, REVIEW_STEP, {})).toEqual([]);
  const twoScopes = { organizationId: ORG, name: "Main", slug: "main", locationId: ORG, assetId: ORG };
  expect(stepProblems(create, scope, twoScopes)).toEqual([]);
  expect(bodyProblems(create, twoScopes).length).toBeGreaterThan(0);
  expect(bodyProblems(create, { organizationId: ORG, name: "Main", slug: "main" })).toEqual([]);
  expect(wizardBody({ a: 1, b: undefined })).toEqual({ a: 1 });
  expect(wizardBody({})).toEqual({});
}

/** A fill reaches only its own entry's wizard, and only the named step's fields. */
export function aFillIsTakenOnlyForItsStepsFields(): void {
  const steps = wizardStepsOf(entry("dashboard.create"));
  const filled = applyFill("dashboard.create", steps, { slug: "keep" }, {
    catalogId: "dashboard.create",
    stepId: "basics",
    values: { name: "Main", organizationId: ORG },
  });
  expect(filled).toEqual({ slug: "keep", name: "Main" });
  expect(applyFill("dashboard.update", steps, {}, { catalogId: "dashboard.create", stepId: "basics", values: { name: "x" } })).toBeNull();
  expect(applyFill("dashboard.create", steps, {}, { catalogId: "dashboard.create", stepId: "nope", values: {} })).toBeNull();
}

/** The `guardTabSwitch` rule: a clean wizard leaves silently; a dirty one asks. */
export function leavingADirtyWizardAsks(): void {
  expect(guardWizardLeave(false, "Create a dashboard")).toEqual({ allow: true });
  const decision = guardWizardLeave(true, "Create a dashboard");
  expect(decision.allow).toBe(false);
  if (!decision.allow) {
    expect(decision.prompt).toContain("Create a dashboard");
    expect(decision.confirmLabel).toBe("Discard and leave");
  }
}

/**
 * `F3.86` PR 2 — the Review step parses the model's body, so a `clientOnly`
 * field (which no step shows) is not asked for there; the page that owns the
 * wizard adds it on submit. A fixture: `calcOverride.set` with one required
 * field made `clientOnly`. Mutation: parse `entry.body` → the first reddens.
 */
export function theReviewStepDoesNotAskForAClientOnlyField(): void {
  const base = entry("calcOverride.set");
  const withClientOnly = { ...base, clientOnly: ["maxInputAgeSeconds"] };
  const body = { formula: null, formulaDialect: null, calcTrigger: null, calcIntervalSeconds: null };
  expect(bodyProblems(withClientOnly, body)).toEqual([]);
  // The positive control: the same body without the clientOnly rule misses the field.
  expect(bodyProblems(base, body).length).toBeGreaterThan(0);
}
