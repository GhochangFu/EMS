import { expect } from "vitest";
import { z, type ZodTypeAny } from "zod";

import * as contracts from "../../contracts";
import {
  catalogEntry,
  catalogParamsOf,
  catalogPath,
  COPILOT_CATALOG,
  DELETE_ALLOWANCE,
  EXCLUDED_ROUTES,
  formulaRefsOf,
  formulaSitesOf,
  pathParamsOf,
  proposeToolName,
} from "./index";
import { modelBodyOf } from "./model-body";
import { bodyFieldsOf, objectShapeOf, stepValuesSchema } from "./object-shape";
import { emptyBody } from "./summary-text";
import type { CatalogEntry, CatalogFormula } from "./types";

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
  "assetTemplate.update": {
    body: {
      points: [
        { pointKey: "kw", kind: "measured" },
        { pointKey: "kw_x2", kind: "derived", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" },
      ],
      content: { kpis: [{ code: "kw_avg", name: "Average kW", pointKeys: ["kw"], expression: "{kw}", dialect: "bms-calc-v1" }] },
    },
    params: { id: ROW },
    names: TARGET_NAME,
  },
  "assetTemplate.publish": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 4: what the model proposes (`modelBodyOf`) — a create has no password.
  "user.create": {
    body: { email: "priya@example.test", displayName: "Priya Rao", role: "viewer", organizationId: ORG },
    params: {},
    names: "Priya Rao",
  },
  "user.update": { body: { displayName: "Renamed" }, params: { id: ROW }, names: TARGET_NAME },
  "user.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "user.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "userGrant.add": { body: { kind: "location", targetId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "userGrant.remove": { body: {}, params: { id: ROW, kind: "location", grantId: ROW }, names: TARGET_NAME },
  "location.controlRoomView.set": { body: { kind: "dashboard", dashboardId: ROW }, params: { id: ROW }, names: TARGET_NAME },
  "location.siteLayout.make": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  // `F3.86` PR 3c — asset groups and their members, and the point-key catalog (ruling Q1).
  "assetGroup.create": {
    body: { locationId: ROW, code: "WATER", name: "Water Plant", description: null, domain: "water" },
    params: {},
    names: "Water Plant",
  },
  "assetGroup.update": { body: { name: "Renamed", description: "x" }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.add": { body: { assetId: ORG, role: "raw_water_pump" }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.setRole": { body: { role: null }, params: { id: ROW }, names: TARGET_NAME },
  "assetGroup.member.remove": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.create": {
    body: { code: "kw_total", name: "Total kW", domain: "electrical", unit: "kW", headlineRank: null },
    params: {},
    names: "kw_total",
  },
  "pointKey.update": { body: { name: "Renamed", headlineRank: 3 }, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.deactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
  "pointKey.reactivate": { body: {}, params: { id: ROW }, names: TARGET_NAME },
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
    // The body the model proposes (`F3.86` PR 2): an entry's `clientOnly` fields are not in it.
    const parsed = modelBodyOf(entry).safeParse(fixture.body);
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

/** The `DELETE` entries whose route is not on {@link DELETE_ALLOWANCE}. */
function deletesOutsideTheAllowance(entries: readonly Pick<CatalogEntry, "id" | "method" | "path">[]): string[] {
  return entries
    .filter((entry) => entry.method === "DELETE")
    .filter((entry) => !DELETE_ALLOWANCE.some((allowed) => allowed.path === entry.path))
    .map((entry) => entry.id);
}

/**
 * Decision 3, ruling 19 (`F3.86` PR 2): the allowance names exactly the two
 * removals; no `DELETE` entry is outside it. PR 3c adds the member removal;
 * PR 4 adds `userGrant.remove` beside it.
 */
export function theOnlyDeleteEntriesAreTheTwoRemovals(): void {
  expect(DELETE_ALLOWANCE.map((route) => route.path).sort()).toEqual([
    "/admin/asset-group-members/:id",
    "/admin/users/:id/grants/:kind/:grantId",
  ]);
  expect(deletesOutsideTheAllowance(COPILOT_CATALOG)).toEqual([]);
  // PR 4 adds the grant revoke; PR 3c adds the member removal.
  expect(COPILOT_CATALOG.filter((entry) => entry.method === "DELETE").map((entry) => entry.id).sort()).toEqual([
    "assetGroup.member.remove",
    "userGrant.remove",
  ]);
}

/** Decision 3, ruling 19 (`F3.86` PR 3c): a removal is red on the card — its risk is `deactivate` — and takes no body. */
export function theMemberRemovalIsARedBodylessDelete(): void {
  const entry = catalogEntry("assetGroup.member.remove");
  if (!entry) throw new Error("assetGroup.member.remove");
  expect({ method: entry.method, path: entry.path, risk: entry.risk, bodyName: entry.bodyName, steps: entry.steps }).toEqual({
    method: "DELETE",
    path: "/admin/asset-group-members/:id",
    risk: "deactivate",
    bodyName: null,
    steps: [],
  });
}

/** Ruling Q1 (`F3.86` PR 3c): a point-key write lives in the bound organization — a `fleet` create, a `pointKey` row. */
export function thePointKeyEntriesAreFleetTargets(): void {
  const targets = ["pointKey.create", "pointKey.update", "pointKey.deactivate", "pointKey.reactivate"].map(
    (id) => catalogEntry(id)?.target,
  );
  expect(targets).toEqual([
    { kind: "fleet" },
    { kind: "pointKey", param: "id" },
    { kind: "pointKey", param: "id" },
    { kind: "pointKey", param: "id" },
  ]);
}

/** The rule is not vacuous: an allowed removal passes it and any other `DELETE` does not. */
export function aDeleteOutsideTheAllowanceIsRefused(): void {
  expect(deletesOutsideTheAllowance([{ id: "userGrant.remove", method: "DELETE", path: "/admin/users/:id/grants/:kind/:grantId" }])).toEqual([]);
  expect(deletesOutsideTheAllowance([{ id: "assetGroup.member.remove", method: "DELETE", path: "/admin/asset-group-members/:id" }])).toEqual([]);
  expect(deletesOutsideTheAllowance([{ id: "dashboard.delete", method: "DELETE", path: "/dashboards/:id" }])).toEqual(["dashboard.delete"]);
}

/** A `clientOnly` fixture: a refined body (`ZodEffects`), which `.omit` cannot narrow, and the `modelBody` it needs. */
const PASSWORD_OBJECT = z.object({ email: z.string().email(), temporaryPassword: z.string().min(12) }).strict();
const PASSWORD_BODY = PASSWORD_OBJECT.superRefine(() => undefined);
const PASSWORD_MODEL_BODY = z.object({ email: z.string().email() }).strict();
const passwordEntry = (modelBody: ZodTypeAny | undefined) => ({
  id: "fixture.user.create",
  body: PASSWORD_BODY,
  clientOnly: ["temporaryPassword"] as const,
  ...(modelBody ? { modelBody } : {}),
});

/** Every `modelBody` is strict and holds exactly the body's fields without the `clientOnly` ones. */
function modelBodyProblems(entry: Pick<CatalogEntry, "id" | "body" | "clientOnly" | "modelBody">): string[] {
  if (entry.modelBody === undefined) return [];
  const problems: string[] = [];
  let object: ZodTypeAny = entry.modelBody;
  while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
  if ((object as z.AnyZodObject)._def.unknownKeys !== "strict") problems.push(`${entry.id}: modelBody is not strict`);
  const expected = bodyFieldsOf(entry.body).filter((field) => !entry.clientOnly.includes(field)).sort();
  if (JSON.stringify(bodyFieldsOf(entry.modelBody).sort()) !== JSON.stringify(expected)) {
    problems.push(`${entry.id}: modelBody fields differ from the body's without clientOnly`);
  }
  return problems;
}

/**
 * `F3.86` PR 2: the model never sees a `clientOnly` field — for every entry,
 * and for the fixture whose refined body needs a `modelBody`.
 */
export function noClientOnlyFieldReachesTheModelBody(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(modelBodyProblems(entry), entry.id).toEqual([]);
    const fields = bodyFieldsOf(modelBodyOf(entry));
    for (const field of entry.clientOnly) expect(fields, entry.id).not.toContain(field);
    // A clientOnly key the model sends anyway must fail the parse (security review L1).
    if (entry.clientOnly.length > 0) {
      let object: ZodTypeAny = modelBodyOf(entry);
      while (object instanceof z.ZodEffects) object = object._def.schema as ZodTypeAny;
      expect((object as z.AnyZodObject)._def.unknownKeys, entry.id).toBe("strict");
    }
  }
  const fixture = passwordEntry(PASSWORD_MODEL_BODY);
  expect(modelBodyProblems(fixture)).toEqual([]);
  expect(bodyFieldsOf(modelBodyOf(fixture))).toEqual(["email"]);
  expect(modelBodyOf(fixture).safeParse({ email: "a@b.co", temporaryPassword: "x".repeat(12) }).success).toBe(false);
}

/** The `modelBody` rule is not vacuous: a `modelBody` that keeps the password is refused. */
export function aModelBodyThatKeepsAClientOnlyFieldIsRefused(): void {
  expect(modelBodyProblems(passwordEntry(PASSWORD_OBJECT))).toEqual([
    "fixture.user.create: modelBody fields differ from the body's without clientOnly",
  ]);
  expect(modelBodyProblems(passwordEntry(PASSWORD_MODEL_BODY.passthrough()))).toEqual(["fixture.user.create: modelBody is not strict"]);
}

/** Without a `modelBody`, a plain object body loses its `clientOnly` fields, and a refined one is a load error. */
export function modelBodyOfOmitsOrRefuses(): void {
  const plain = { id: "fixture.plain", body: PASSWORD_OBJECT, clientOnly: ["temporaryPassword"] as const };
  expect(bodyFieldsOf(modelBodyOf(plain))).toEqual(["email"]);
  // A body in strip mode still gives a strict model body: the key is refused, not stripped and stored.
  const stripping = { id: "fixture.strip", body: PASSWORD_OBJECT.strip(), clientOnly: ["temporaryPassword"] as const };
  expect(modelBodyOf(stripping).safeParse({ email: "a@b.co", temporaryPassword: "x".repeat(12) }).success).toBe(false);
  expect(modelBodyOf(stripping).safeParse({ email: "a@b.co" }).success).toBe(true);
  expect(() => modelBodyOf(passwordEntry(undefined))).toThrow(/needs a modelBody/);
  const none = catalogEntry("dashboard.create");
  if (!none) throw new Error("dashboard.create");
  expect(modelBodyOf(none)).toBe(none.body);
}

export function pathParamsAndTheirSchemasAgree(): void {
  for (const entry of COPILOT_CATALOG) {
    expect(Object.keys(entry.params).sort(), entry.id).toEqual(pathParamsOf(entry.path).sort());
    // A target named by a path parameter (not a create's organization, parent or fleet row) names one of the route's.
    if ("param" in entry.target) {
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

/** Through refinements, optionals, defaults and a pipeline's output, to the schema that holds the value. */
function unwrapValue(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodEffects) current = current._def.schema as ZodTypeAny;
    else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current._def.innerType as ZodTypeAny;
    } else if (current instanceof z.ZodPipeline) current = current._def.out as ZodTypeAny;
    else return current;
  }
}

/** The schema at a catalog formula path (`content.kpis[].expression`), or `undefined` when the body has no such field. */
export function schemaAtPath(schema: ZodTypeAny, path: string): ZodTypeAny | undefined {
  let current: ZodTypeAny = schema;
  for (const segment of path.split(".")) {
    const many = segment.endsWith("[]");
    const key = many ? segment.slice(0, -2) : segment;
    const object = unwrapValue(current);
    if (!(object instanceof z.ZodObject)) return undefined;
    const next = (object.shape as Record<string, ZodTypeAny>)[key];
    if (next === undefined) return undefined;
    current = next;
    if (many) {
      const array = unwrapValue(current);
      if (!(array instanceof z.ZodArray)) return undefined;
      current = array.element as ZodTypeAny;
    }
  }
  return current;
}

export function refsAndFormulasNameBodyFields(): void {
  for (const entry of COPILOT_CATALOG) {
    const fields = bodyFieldsOf(entry.body);
    for (const ref of entry.refs) expect(fields, `${entry.id} ref`).toContain(ref.field);
    for (const formula of entry.formulas) {
      for (const path of [formula.field, formula.dialectField, formula.refsField]) {
        if (path === undefined) continue;
        expect(schemaAtPath(entry.body, path), `${entry.id} ${path}`).toBeDefined();
      }
    }
  }
}

/** The path check is not vacuous: a misspelled leaf and a non-array segment resolve to nothing; the real path resolves. */
export function aFormulaPathTheBodyLacksResolvesToNothing(): void {
  const body = catalogEntry("assetTemplate.update")?.body;
  if (!body) throw new Error("assetTemplate.update");
  expect(schemaAtPath(body, "content.kpis[].expression")).toBeDefined();
  expect(schemaAtPath(body, "content.kpis[].expresion")).toBeUndefined();
  expect(schemaAtPath(body, "name[].expression")).toBeUndefined();
}

const KPI_FORMULA: CatalogFormula = {
  field: "content.kpis[].expression",
  dialectField: "content.kpis[].dialect",
  refsField: "points[].pointKey",
};
const KPI_BODY = {
  points: [{ pointKey: "kw" }, { pointKey: "kva" }],
  content: {
    kpis: [
      { expression: "{kw}", dialect: "bms-calc-v1" },
      { expression: "{kva}", dialect: "unvalidated" },
    ],
  },
};

/** An array path names one site per item, each with the dialect from the same item. */
export function aFormulaPathNamesOneSitePerItem(): void {
  expect(formulaSitesOf(KPI_BODY, KPI_FORMULA)).toEqual([
    { path: "content.kpis.0.expression", expression: "{kw}", dialect: "bms-calc-v1" },
    { path: "content.kpis.1.expression", expression: "{kva}", dialect: "unvalidated" },
  ]);
}

/** A refs path collects every name at it across the body. */
export function aRefsPathCollectsEveryName(): void {
  expect(formulaRefsOf(KPI_BODY, KPI_FORMULA)).toEqual(["kw", "kva"]);
}

/** A body that does not carry the formula path has no site. */
export function aBodyWithoutTheFormulaPathHasNoSite(): void {
  expect(formulaSitesOf({ name: "x" }, KPI_FORMULA)).toEqual([]);
}

/** A body that does not carry the refs path answers `null`: the target's names apply. */
export function aBodyWithoutTheRefsPathHasNoRefs(): void {
  expect(formulaRefsOf({ name: "x" }, KPI_FORMULA)).toBeNull();
}

const TOP_LEVEL_FORMULA: CatalogFormula = { field: "formula", dialectField: "formulaDialect" };

/** A top-level formula is one site at its own key. */
export function aTopLevelFormulaIsOneSite(): void {
  expect(formulaSitesOf({ formula: "{kw}", formulaDialect: "bms-calc-v2" }, TOP_LEVEL_FORMULA)).toEqual([
    { path: "formula", expression: "{kw}", dialect: "bms-calc-v2" },
  ]);
}

/** A formula with no refs path takes the target's names (`null`). */
export function aFormulaWithoutARefsPathHasNoRefs(): void {
  expect(formulaRefsOf({ formula: "{kw}" }, TOP_LEVEL_FORMULA)).toBeNull();
}

/** A dialect outside the formula's own item is a catalog error, not a silent mismatch. */
export function aDialectOutsideTheFormulasItemIsAnError(): void {
  expect(() => formulaSitesOf(KPI_BODY, { field: "content.kpis[].expression", dialectField: "dialect" })).toThrow(/same item/);
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

/** `F3.86` PR 4: the grant summaries name the grant target when the server resolved it, and the id otherwise. */
export function aGrantSummaryNamesItsTarget(): void {
  const add = catalogEntry("userGrant.add");
  const remove = catalogEntry("userGrant.remove");
  if (!add || !remove) throw new Error("userGrant entries");
  const base = { targetName: "Priya Rao", organizationName: ORG_NAME };
  expect(add.summary({ ...base, body: { kind: "location", targetId: ROW }, params: { id: ROW }, refName: "RSMOC-WC" })).toBe(
    'Grant "Priya Rao" access to the site "RSMOC-WC".',
  );
  expect(remove.summary({ ...base, body: {}, params: { id: ROW, kind: "asset_group", grantId: ROW }, refName: "LV boards" })).toBe(
    'Revoke the access of "Priya Rao" to the asset group "LV boards".',
  );
  expect(add.summary({ ...base, body: { kind: "organization", targetId: ROW }, params: { id: ROW } })).toContain(ROW);
}
