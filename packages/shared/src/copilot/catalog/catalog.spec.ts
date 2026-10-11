import { expect } from "vitest";
import { z, type ZodTypeAny } from "zod";

import * as contracts from "../../contracts";
import {
  catalogEntry,
  catalogParamsOf,
  catalogPath,
  COPILOT_CATALOG,
  EXCLUDED_ROUTES,
  pathParamsOf,
  proposeToolName,
} from "./index";
import { bodyFieldsOf, objectShapeOf, stepValuesSchema } from "./object-shape";
import { emptyBody } from "./summary-text";
import type { CatalogEntry } from "./types";

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 6 (plan §10.1) — the catalog's own
 * rules. The route side (every write route is an entry or excluded, the
 * controller parses the same export) is `tests/f3.85-catalog-coverage.test.ts`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const TARGET_NAME = "Target Row 7";
const ORG_NAME = "Org Seven";

/** One valid body and path per entry, and the name its summary must contain. */
export const FIXTURES: Readonly<
  Record<string, { body: Record<string, unknown>; params: Record<string, string>; names: string }>
> = {
  "dashboard.create": { body: { organizationId: ORG, slug: "main-tx", name: "Main TX" }, params: {}, names: "Main TX" },
  "dashboard.update": { body: { name: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "dashboard.widgets.replace": { body: { widgets: [] }, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.create": {
    body: { organizationId: ORG, code: "tpl-1", name: "Feeder Template", section: "operations" },
    params: {},
    names: "Feeder Template",
  },
  "dashboardTemplate.update": { body: { name: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.publish": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.archive": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.draft": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "dashboardTemplate.instantiate": {
    body: { assetGroupId: null, slug: "from-tpl", name: "From Template" },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  "dashboardTemplate.importStock": { body: { organizationId: ORG }, params: { code: "smoc-standard" }, names: ORG_NAME },
  "dashboardTemplate.applyToSites": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "calcParameter.create": {
    body: { organizationId: ORG, key: "tariff_rate", value: 1.5, effectiveFrom: "2026-10-01T00:00:00+00:00" },
    params: {},
    names: "tariff_rate",
  },
  "calcParameter.update": { body: { value: 2 }, params: { id: ROW }, names: TARGET_NAME },
  "calcOverride.set": {
    body: { formula: null, formulaDialect: null, calcTrigger: null, calcIntervalSeconds: null, maxInputAgeSeconds: 60 },
    params: { assetId: ROW, pointKey: "kw_total" },
    names: TARGET_NAME,
  },
};

const summaryOf = (entry: CatalogEntry) => {
  const fixture = FIXTURES[entry.id];
  if (!fixture) throw new Error(`no fixture for ${entry.id}`);
  return entry.summary({ body: fixture.body, params: fixture.params, targetName: TARGET_NAME, organizationName: ORG_NAME });
};

export function everyEntryHasAFixtureAndOnlyThose(): void {
  expect(Object.keys(FIXTURES).sort()).toEqual(COPILOT_CATALOG.map((entry) => entry.id).sort());
}

/** The body is the very export the controller parses (decision 2: "the body is the controller's schema"). */
export function everyBodyIsTheSharedExportByIdentity(): void {
  const exports = contracts as unknown as Record<string, unknown>;
  for (const entry of COPILOT_CATALOG) {
    if (entry.bodyName === null) {
      expect(entry.body, entry.id).toBe(emptyBody);
    } else {
      expect(exports[entry.bodyName], entry.id).toBeDefined();
      expect(entry.body, entry.id).toBe(exports[entry.bodyName]);
    }
  }
}

export function aBodylessEntryTakesOnlyTheEmptyObject(): void {
  expect(emptyBody.safeParse({}).success).toBe(true);
  expect(emptyBody.safeParse({ x: 1 }).success).toBe(false);
}

export function everyFixtureBodyAndPathParses(): void {
  for (const entry of COPILOT_CATALOG) {
    const fixture = FIXTURES[entry.id];
    if (!fixture) throw new Error(entry.id);
    const parsed = entry.body.safeParse(fixture.body);
    expect(parsed.success, `${entry.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    for (const [name, schema] of Object.entries(entry.params)) {
      expect((schema as ZodTypeAny).safeParse(fixture.params[name]).success, `${entry.id} :${name}`).toBe(true);
    }
  }
}

export function everySummaryNamesItsTarget(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(summaryOf(entry), entry.id).toContain(FIXTURES[entry.id]?.names);
  }
}

export function idsAndToolNamesAreUniqueAndProviderSafe(): void {
  const ids = COPILOT_CATALOG.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  const names = COPILOT_CATALOG.map(proposeToolName);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(catalogEntry("dashboard.create")?.id).toBe("dashboard.create");
  expect(catalogEntry("dashboard.delete")).toBeUndefined();
}

/** Decision 3: release 1 holds no hard delete. */
export function noEntryIsADelete(): void {
  for (const entry of COPILOT_CATALOG) expect(entry.method as string, entry.id).not.toBe("DELETE");
}

export function pathParamsAndTheirSchemasAgree(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(Object.keys(entry.params).sort(), entry.id).toEqual(pathParamsOf(entry.path).sort());
    if (entry.target.kind !== "organization") {
      expect(Object.keys(entry.params), entry.id).toContain(entry.target.param);
    }
  }
}

/** Ruling Q6: each body field is in exactly one step, and no step names a field the body lacks. */
export function everyBodyFieldIsInExactlyOneStep(): void {
  for (const entry of COPILOT_CATALOG) {
    const inSteps = entry.steps.flatMap((step) => step.fields);
    expect(new Set(inSteps).size, `${entry.id}: a field in two steps`).toBe(inSteps.length);
    const fields = bodyFieldsOf(entry.body).filter((field) => !entry.clientOnly.includes(field));
    expect([...inSteps].sort(), entry.id).toEqual([...fields].sort());
    for (const field of entry.clientOnly) expect(inSteps, entry.id).not.toContain(field);
  }
}

export function refsAndFormulasNameBodyFields(): void {
  for (const entry of COPILOT_CATALOG) {
    const fields = bodyFieldsOf(entry.body);
    for (const ref of entry.refs) expect(fields, `${entry.id} ref`).toContain(ref.field);
    for (const formula of entry.formulas) {
      expect(fields, `${entry.id} formula`).toContain(formula.field);
      expect(fields, `${entry.id} dialect`).toContain(formula.dialectField);
    }
  }
}

export function noRouteIsBothAnEntryAndExcluded(): void {
  const keys = EXCLUDED_ROUTES.map((route) => `${route.method} ${route.path}`);
  expect(new Set(keys).size).toBe(keys.length);
  for (const entry of COPILOT_CATALOG) expect(keys).not.toContain(`${entry.method} ${entry.path}`);
}

/** `objectShapeOf` unwraps a refinement and splits a union; anything else is a load error. */
export function objectShapeUnwrapsEffectsAndUnions(): void {
  expect(Object.keys(objectShapeOf(contracts.createDashboardBodySchema)[0] ?? {})).toContain("slug");
  expect(objectShapeOf(contracts.instantiateSectionTemplateBodySchema)).toHaveLength(2);
  expect(() => objectShapeOf(z.string())).toThrow(/must be an object/);
}

export function aStepSchemaIsPartialAndStrict(): void {
  const basics = stepValuesSchema(contracts.createDashboardBodySchema, ["name", "slug"]);
  expect(basics.safeParse({ name: "A" }).success).toBe(true);
  expect(basics.safeParse({ name: "" }).success).toBe(false);
  expect(basics.safeParse({ name: "A", organizationId: ORG }).success).toBe(false);
  expect(() => stepValuesSchema(contracts.createDashboardBodySchema, ["nope"])).toThrow(/not a body field/);
}

/** The stored path is the raw path a browser sends: `fetch` must not re-encode it, or the interceptor's compare fails. */
export function aStoredPathSurvivesTheBrowserUnchanged(): void {
  const entry = catalogEntry("calcOverride.set");
  if (!entry) throw new Error("calcOverride.set");
  const path = catalogPath(entry, { assetId: ROW, pointKey: "kw total%/x'(y)" });
  expect(path).toBe(`/api/v1/admin/assets/${ROW}/calc-points/kw%20total%25%2Fx'(y)`);
  expect(new URL(path, "http://api.local").pathname).toBe(path);
  expect(() => catalogPath(entry, { assetId: ROW })).toThrow(/pointKey/);
  // The inverse: the card reads the parameters back from the stored path.
  expect(catalogParamsOf(entry, path)).toEqual({ assetId: ROW, pointKey: "kw total%/x'(y)" });
  expect(catalogParamsOf(entry, `/api/v1/admin/assets/${ROW}/calc-points`)).toBeNull();
  expect(catalogParamsOf(entry, `/api/v1/admin/assets/${ROW}/calc-points/%E0%A4%A`)).toBeNull();
}

/**
 * Every body object is `.strict()`: the stored body is the one the model sent,
 * so a key the schema does not name must fail the parse rather than be
 * stripped and still stored (the `clientOnly` rule depends on it).
 */
export function everyBodyObjectIsStrict(): void {
  for (const entry of COPILOT_CATALOG) {
    let current: ZodTypeAny = entry.body;
    while (current instanceof z.ZodEffects) current = current._def.schema as ZodTypeAny;
    const members = current instanceof z.ZodUnion ? (current.options as ZodTypeAny[]) : [current];
    for (const member of members) {
      let object: ZodTypeAny = member;
      while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
      expect((object as z.AnyZodObject)._def.unknownKeys, entry.id).toBe("strict");
    }
  }
}

/** A dot segment is refused as a point key: the browser would resolve it away. */
export function aDotSegmentIsNotAPointKey(): void {
  const params = catalogEntry("calcOverride.set")?.params ?? {};
  for (const bad of [".", ".."]) expect((params.pointKey as ZodTypeAny).safeParse(bad).success, bad).toBe(false);
  expect((params.pointKey as ZodTypeAny).safeParse("kw.total").success).toBe(true);
}

/** Decision 4.9: a widget save says how many current widgets it removes. */
export function theWidgetSummaryCountsRemovedWidgets(): void {
  const entry = catalogEntry("dashboard.widgets.replace");
  if (!entry) throw new Error("dashboard.widgets.replace");
  const summary = entry.summary({
    body: { widgets: [{ id: "keep" }, { widgetType: "chart" }] },
    params: { id: ROW },
    targetName: "Main",
    organizationName: ORG_NAME,
    currentWidgetIds: ["keep", "gone-1", "gone-2"],
  });
  expect(summary).toContain("with 2 widgets");
  expect(summary).toContain("2 current widgets are removed");
}
