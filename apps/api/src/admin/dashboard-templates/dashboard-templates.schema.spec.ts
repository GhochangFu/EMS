import {
  instantiateSectionTemplateBodySchema,
  updateDashboardTemplateBodySchema,
} from "./dashboard-templates.schema";

/**
 * `F3.61` Task 2 — the `PATCH` request boundary reaches the shared contract's
 * `sectionTemplateContentSchema` through `.strict()` and the `.optional()`
 * wrapper, so a widget carrying both binding kinds, or a mis-shaped source, is
 * refused at the boundary and not only inside the shared package's own tests.
 *
 * Analogue of `runStageAFieldsSurviveStrictCompositionTests`
 * (`packages/shared/src/contracts/dashboard-builder.spec.ts`) — this proves
 * the rule reaches the body the global `@Catch(ZodError)` filter turns into a
 * 400, not merely that the underlying schema refuses the value.
 *
 * One exported function per claim, one `it()` per function in the sibling
 * `.test.ts` — so a failing claim reddens only its own `it()`.
 *
 * Assertions live here; `dashboard-templates.schema.test.ts` is the vitest
 * entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Issue = { path: (string | number)[]; message: string };
type SafeParseable = {
  safeParse: (v: unknown) => { success: boolean; error?: { issues: Issue[] } };
};

function expectAccepts(schema: SafeParseable, value: unknown, what: string): void {
  const result = schema.safeParse(value);
  assert(
    result.success === true,
    `${what} — expected success, got a refusal: ${JSON.stringify(result.error?.issues)}`,
  );
}

function expectRejectsAt(
  schema: SafeParseable,
  value: unknown,
  path: (string | number)[],
  pattern: RegExp,
  what: string,
): void {
  const result = schema.safeParse(value);
  assert(result.success === false, `${what} — expected a refusal, got success`);
  const issues = result.error?.issues ?? [];
  const hit = issues.find((issue) => JSON.stringify(issue.path) === JSON.stringify(path));
  assert(
    hit !== undefined,
    `${what} — expected an issue at path ${JSON.stringify(path)}, got ${JSON.stringify(issues)}`,
  );
  assert(
    pattern.test(hit?.message ?? ""),
    `${what} — expected the issue at ${JSON.stringify(path)} to match ${pattern}, got "${hit?.message}"`,
  );
}

const ROLE = { assetRoleCode: "meter", pointKey: "kw" };
const METRIC = { catalogKey: "alarms.active.count", params: {} };

function widget(overrides: Record<string, unknown> = {}): unknown {
  return {
    key: "w",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    bindings: [],
    sources: [],
    widgetType: "value_tile",
    config: {},
    ...overrides,
  };
}

export function rejectsAPatchBodyWhoseWidgetCarriesBothKinds(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [widget({ bindings: [ROLE], sources: [METRIC] })] } },
    ["content", "widgets", 0, "sources"],
    /never both/,
    "a PATCH body whose one widget carries both kinds",
  );
}

/** The positive control the plan intended: the same body as the both-kinds
 * case, minus `sources` — a `bindings: [ROLE]`-only widget parses. */
export function acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding(): void {
  expectAccepts(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [widget({ bindings: [ROLE] })] } },
    "a PATCH body whose widget carries only a role binding",
  );
}

/** A second, weaker control: neither kind also parses. Kept alongside the
 * role-only control above, not instead of it — the role-only case is what
 * mirrors the both-kinds case's shape (same body, `sources` removed). */
export function acceptsAPatchBodyWhoseWidgetCarriesNeitherKind(): void {
  expectAccepts(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [widget({ sources: [] })] } },
    "a PATCH body whose widget carries neither kind",
  );
}

/** Amendment 1 — the second node reaches the boundary the same way. */
export function rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    {
      content: {
        widgets: [
          widget({
            widgetType: "chart",
            gridW: 4,
            gridH: 3,
            config: { series: "line" },
            sources: [METRIC],
          }),
        ],
      },
    },
    ["content", "widgets", 0, "sources"],
    /at most 0/,
    "a PATCH body whose one widget is a chart carrying a metric source",
  );
}

/**
 * `E4.2` U8b, ADR 0072 decision 1 — the instantiate body accepts a **null**
 * `assetGroupId`, which is what lets a role-free section template land
 * organization-wide.
 *
 * Asserted at the REQUEST boundary and not only in the service: `assetGroupId`
 * was `z.string().uuid()`, so before this a null never reached the service at
 * all — the global `@Catch(ZodError)` filter turned it into a 400 the service
 * could not have overridden.
 */
export function acceptsAnInstantiateBodyWithANullAssetGroup(): void {
  expectAccepts(
    instantiateSectionTemplateBodySchema,
    { assetGroupId: null, slug: "enterprise-sustainability", name: "Sustainability" },
    "an instantiate body with a null asset group (the organization-wide arm)",
  );
}

/**
 * The adjacent positive control, and the reason it is here: "null is accepted"
 * alone would still pass if `.nullable()` had been widened to `z.any()`. A uuid
 * must still be a uuid.
 */
export function stillRejectsAnInstantiateBodyWhoseAssetGroupIsNotAUuid(): void {
  expectRejectsAt(
    instantiateSectionTemplateBodySchema,
    // The slug is a VALID one on purpose. It used to be `"x"`, which the slug
    // rule below now refuses on two counts — so the fixture would have been
    // refused whatever `assetGroupId` held, and this control would have gone on
    // passing with the uuid rule deleted. A negative fixture must be wrong in
    // exactly one place.
    { assetGroupId: "not-a-uuid", slug: "valid-slug", name: "x" },
    ["assetGroupId"],
    /uuid/i,
    "an instantiate body whose asset group is neither a uuid nor null",
  );
}

/**
 * `E4.2` PR 2 security review — the instantiate door applies the SAME slug rule
 * as `POST /dashboards`.
 *
 * Both refusals and the positive control are here rather than split: the claim
 * is that one rule governs one column, and a charset refusal with no accepted
 * spelling beside it cannot tell "the regex is right" from "the regex refuses
 * everything".
 */
export function theInstantiateSlugTakesTheSameCharsetAsTheDashboardWriteDoor(): void {
  expectRejectsAt(
    instantiateSectionTemplateBodySchema,
    { assetGroupId: null, slug: "x?a=b", name: "Sustainability" },
    ["slug"],
    /Invalid/i,
    "an instantiate body whose slug carries a query string — it is addressed as a path segment",
  );
  expectRejectsAt(
    instantiateSectionTemplateBodySchema,
    { assetGroupId: null, slug: "a/b", name: "Sustainability" },
    ["slug"],
    /Invalid/i,
    "an instantiate body whose slug carries a path separator",
  );
  expectAccepts(
    instantiateSectionTemplateBodySchema,
    { assetGroupId: null, slug: "enterprise-sustainability-2026", name: "Sustainability" },
    "an instantiate body whose slug is lowercase letters, digits and hyphens",
  );
}
