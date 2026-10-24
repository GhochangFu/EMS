import { expect } from "vitest";
import { COPILOT_CATALOG, catalogEntry } from "@bms/shared/copilot";

import { CHANGE_VALUE_MAX, type ChangeRow, changeRows, fieldLabel, formatChangeValue } from "./copilot-diff";
import { INVALIDATED_ENTRIES, invalidationKeysFor, onboardingDraftsKey } from "./copilot-invalidations";
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
  // `F3.86` PR 3a: the pages' own keys (`locations-page.tsx`, `rtus-page.tsx`, `admin-breadcrumb.tsx`).
  for (const id of ["location.create", "location.update", "location.deactivate", "location.reactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "locations"], ["admin", "location-summary"]]);
  }
  for (const id of ["rtu.create", "rtu.update", "rtu.deactivate", "rtu.reactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "rtus"], ["admin", "rtu-summary"]]);
  }
  // `F3.86` PR 3b: `assets-page.tsx`, `admin-breadcrumb.tsx` and `asset-points-page.tsx`.
  for (const id of ["asset.create", "asset.reactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "assets"], ["admin", "asset-summary"]]);
  }
  // Deactivating an asset also deactivates its point mappings (`AssetsAdminService.deactivate`); reactivate leaves them.
  expect(invalidationKeysFor("asset.deactivate")).toEqual([["admin", "assets"], ["admin", "asset-summary"], ["admin", "asset-points"]]);
  // A rename or move: the point rows and a group's members join the asset's labels.
  expect(invalidationKeysFor("asset.update")).toEqual([
    ["admin", "assets"],
    ["admin", "asset-summary"],
    ["admin", "asset-points"],
    ["admin", "asset-groups"],
  ]);
  for (const id of ["assetPoint.create", "assetPoint.update", "assetPoint.deactivate", "assetPoint.reactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["admin", "asset-points"]]);
  }
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
    params: {},
    stepId: "basics",
    values: { name: "Main", organizationId: ORG },
  });
  expect(filled).toEqual({ slug: "keep", name: "Main" });
  expect(applyFill("dashboard.update", steps, {}, { catalogId: "dashboard.create", params: {}, stepId: "basics", values: { name: "x" } })).toBeNull();
  expect(applyFill("dashboard.create", steps, {}, { catalogId: "dashboard.create", params: {}, stepId: "nope", values: {} })).toBeNull();
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

/**
 * `F4.255` PR 3 (plan §6.2): a committed onboarding leaves the dock's draft list. The row's key is
 * a prefix of every organization's list key, so one entry reaches them all.
 */
export function anOnboardingCommitInvalidatesTheDraftList(): void {
  const keys = invalidationKeysFor("onboarding.commit");
  expect(keys).toContainEqual(["admin", "onboarding", "drafts"]);
  expect(onboardingDraftsKey(ORG)).toEqual(["admin", "onboarding", "drafts", ORG]);
}

/** `F3.87` PR 5: both layout entries re-read the layout library and, under its prefix, each layout. */
export function theLayoutEntriesInvalidateTheLayouts(): void {
  for (const id of ["mimicLayout.create", "mimicLayout.replace"]) {
    expect(invalidationKeysFor(id), id).toEqual([["mimic-layouts"]]);
  }
}

/** `F3.87` PR 5 (D14, D15): a skipped key (a `cardOnly` one) is no row; the others keep their order. */
export function changeRowsSkipsTheNamedKeys(): void {
  const rows = changeRows({ name: "L", baseline: { version: 1 }, slug: "l" }, null, ["baseline"]);
  expect(rows.map((row) => row.field)).toEqual(["name", "slug"]);
  expect(changeRows({ name: "L", baseline: 1 }, null).map((row) => row.field)).toEqual(["name", "baseline"]);
}

/*
 * `F4.246` (ADR 0099 §3, owner ruling 2026-10-20 option C, "Summary + expand") — the row keeps
 * its 160-character summary and carries the full value beside it for the card to expand, and a
 * template body gets one full-text row per formula site, paired with the Now site by identity.
 */

const BIG = { kpis: Array.from({ length: 12 }, (_, index) => ({ code: `k${index}`, expression: "kw * 2" })) };
const BIG_NOW = { kpis: Array.from({ length: 12 }, (_, index) => ({ code: `n${index}`, expression: "kw * 3" })) };
const TEMPLATE_FORMULAS = entry("assetTemplate.update").formulas;
const LONG_EXPRESSION = `kw + ${"kw * 1 + ".repeat(32)}kw`;
const measured = (pointKey: string) => ({ pointKey, kind: "measured", formula: null, formulaDialect: null });
const derived = (pointKey: string, formula: string, formulaDialect: string | null = "bms-calc-v1") => ({
  pointKey,
  kind: "derived",
  formula,
  formulaDialect,
});
const kpi = (code: string, expression: string) => ({ code, expression, dialect: "bms-calc-v1", pointKeys: ["kw"] });
const rowAt = (rows: readonly ChangeRow[], field: string): ChangeRow => {
  const found = rows.find((row) => row.field === field);
  if (!found) throw new Error(`no row ${field} in ${rows.map((row) => row.field).join(", ")}`);
  return found;
};

/** A value longer than the cut keeps its summary and carries the whole pretty-printed value. */
export function aLongValueCarriesItsFullText(): void {
  const [row] = changeRows({ content: BIG }, null);
  expect(row?.after).toHaveLength(CHANGE_VALUE_MAX);
  expect(row?.after.endsWith("…")).toBe(true);
  expect(row?.afterFull).toBe(JSON.stringify(BIG, null, 2));
}

/** A value inside the cut is shown whole already, so it carries no full text (and no expand control). */
export function aShortValueHasNoFullText(): void {
  const [row] = changeRows({ name: "ten chars." }, null);
  expect(row?.after).toBe("ten chars.");
  expect(row).not.toHaveProperty("afterFull");
}

/** An edit's Now value is carried in full too — its own value, not the proposed one. */
export function anEditCarriesTheFullNowValueToo(): void {
  const [row] = changeRows({ content: BIG }, { content: BIG_NOW });
  expect(row?.beforeFull).toBe(JSON.stringify(BIG_NOW, null, 2));
  expect(row?.changed).toBe(true);
}

/** Each formula site is its own row, under its issue path, with the whole expression and its dialect. */
export function formulaRowsShowEachSiteInFull(): void {
  const body = { points: [measured("kw"), derived("eff", LONG_EXPRESSION, "bms-calc-v2")], content: { kpis: [kpi("load", "kw * 2")] } };
  const rows = changeRows(body, null, [], TEMPLATE_FORMULAS);
  expect(rows.map((row) => row.field)).toEqual(["points", "content", "points.1.formula", "content.kpis.0.expression"]);
  expect(rowAt(rows, "points.1.formula")).toEqual({
    field: "points.1.formula",
    label: "Formula eff (points)",
    after: `${LONG_EXPRESSION} (bms-calc-v2)`,
    changed: true,
  });
}

/** A Now site that holds the same expression and dialect is formatted alike, so the row is unchanged. */
export function anUnchangedFormulaRowIsNotChanged(): void {
  const body = { content: { kpis: [kpi("load", "kw * 2")] } };
  const rows = changeRows(body, { content: { kpis: [kpi("load", "kw * 2")] } }, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "content.kpis.0.expression")).toMatchObject({
    before: "kw * 2 (bms-calc-v1)",
    after: "kw * 2 (bms-calc-v1)",
    changed: false,
  });
}

/** A changed formula shows the Now expression, formatted the same way, and is marked changed. */
export function aChangedFormulaShowsTheNowExpression(): void {
  const body = { points: [measured("kw"), derived("eff", "kw * 3")] };
  const rows = changeRows(body, { points: [measured("kw"), derived("eff", "kw * 2")] }, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "points.1.formula")).toMatchObject({
    before: "kw * 2 (bms-calc-v1)",
    after: "kw * 3 (bms-calc-v1)",
    changed: true,
  });
}

/** A point inserted ahead of the others: each Now formula is the same point's, by `pointKey`, not the same index's. */
export function aFormulaIsPairedByPointKeyNotIndex(): void {
  const now = { points: [measured("kw"), derived("eff", "kw * 2")] };
  const body = { points: [derived("new", "kw * 5"), measured("kw"), derived("eff", "kw * 2")] };
  const rows = changeRows(body, now, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "points.2.formula")).toMatchObject({ before: "kw * 2 (bms-calc-v1)", changed: false });
}

/** The inserted point has no Now formula: a dash, and a change. */
export function aNewFormulaSiteHasNoNowValue(): void {
  const now = { points: [measured("kw"), derived("eff", "kw * 2")] };
  const body = { points: [derived("new", "kw * 5"), measured("kw"), derived("eff", "kw * 2")] };
  const rows = changeRows(body, now, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "points.0.formula")).toMatchObject({ before: "—", changed: true });
}

/** Reordered KPIs: each Now expression is the same KPI's, by `code`. */
export function aKpiExpressionIsPairedByCodeNotIndex(): void {
  const now = { content: { kpis: [kpi("a", "kw * 1"), kpi("b", "kw * 2")] } };
  const body = { content: { kpis: [kpi("b", "kw * 2"), kpi("a", "kw * 1")] } };
  const rows = changeRows(body, now, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "content.kpis.0.expression")).toMatchObject({ before: "kw * 2 (bms-calc-v1)", changed: false });
}

/** A site with no expression (a measured point's `formula: null`) is no row. */
export function aSiteWithoutAnExpressionIsNoRow(): void {
  const rows = changeRows({ points: [measured("kw")] }, null, [], TEMPLATE_FORMULAS);
  expect(rows.map((row) => row.field)).toEqual(["points"]);
}

/** No formulas passed (an entry without formula sites, and the default call): field rows only. */
export function formulaRowsAreAbsentWithoutFormulas(): void {
  const body = { points: [derived("eff", "kw * 2")] };
  expect(changeRows(body, null, [], []).map((row) => row.field)).toEqual(["points"]);
  expect(changeRows(body, null).map((row) => row.field)).toEqual(["points"]);
}

/** A KPI's formula row is labelled by its `code`. */
export function aKpiFormulaRowIsLabelledByItsCode(): void {
  const rows = changeRows({ content: { kpis: [kpi("load", "kw * 2")] } }, null, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "content.kpis.0.expression").label).toBe("Formula load (kpis)");
}

/** A point and a KPI that share a code get two different row headers (re-review nit). */
export function aPointAndAKpiWithOneCodeAreLabelledApart(): void {
  const body = { points: [derived("eff", "kw * 2")], content: { kpis: [kpi("eff", "kw * 3")] } };
  const labels = changeRows(body, null, [], TEMPLATE_FORMULAS)
    .filter((row) => row.label?.startsWith("Formula "))
    .map((row) => row.label);
  expect(labels).toEqual(["Formula eff (points)", "Formula eff (kpis)"]);
}

/** An item without a `pointKey` or `code` is labelled by its dotted path. */
export function aFormulaRowWithoutAnIdentityIsLabelledByItsPath(): void {
  const rows = changeRows({ points: [{ kind: "derived", formula: "kw * 2", formulaDialect: null }] }, null, [], TEMPLATE_FORMULAS);
  expect(rowAt(rows, "points.0.formula").label).toBe("Formula points.0");
}

/**
 * `calcOverride.set`'s formula site is the top-level `formula`: its field row shows it (and
 * expands), so there is no second, formula row for it — every row's field is unique.
 */
export function aTopLevelFormulaSiteIsOnlyItsFieldRow(): void {
  const body = { formula: "{KW} * 3", formulaDialect: null, calcTrigger: "on_input" };
  const fields = changeRows(body, null, [], entry("calcOverride.set").formulas).map((row) => row.field);
  expect(fields).toEqual(["formula", "formulaDialect", "calcTrigger"]);
}

/** The Now record lists every key (nulls, schema order); a body that leaves nulls out, in its own order, is the same value. */
export function anUnchangedStructuredValueIsNotChanged(): void {
  const now = { points: [{ pointKey: "kw", label: null, unit: "kW", kind: "measured", formula: null }] };
  const body = { points: [{ unit: "kW", kind: "measured", pointKey: "kw" }] };
  expect(changeRows(body, now)[0]?.changed).toBe(false);
}

/** The positive twin: a structured value that differs in one nested field is still a change. */
export function aChangedStructuredValueIsChanged(): void {
  const now = { points: [{ pointKey: "kw", label: null, unit: "kW", kind: "measured", formula: null }] };
  const body = { points: [{ unit: "MW", kind: "measured", pointKey: "kw" }] };
  expect(changeRows(body, now)[0]?.changed).toBe(true);
}

/** `F4.281` (Amendment 8): the three maintenance entries re-read the Schedule Centre (`["maintenance", "schedules", …]`). */
export function theMaintenanceEntriesInvalidateTheScheduleCentre(): void {
  for (const id of ["maintenanceSchedule.create", "maintenanceSchedule.activate", "maintenanceSchedule.deactivate"]) {
    expect(invalidationKeysFor(id), id).toEqual([["maintenance", "schedules"]]);
  }
}
