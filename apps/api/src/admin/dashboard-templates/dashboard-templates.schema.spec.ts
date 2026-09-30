import { ASSET_GROUP_TEMPLATE_TABS_MESSAGE, SITE_TEMPLATE_TOP_LEVEL_MESSAGE } from "@bms/shared";

import {
  createDashboardTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  TEMPLATE_MIMIC_LAYOUT_MESSAGE,
  TEMPLATE_TARGET_BODY_MESSAGE,
  templateTargetBodyMessage,
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

// ---------------------------------------------------------------- F3.32c

const LAYOUT_ID = "8f1d2c3b-4a5e-4f60-9a7b-1c2d3e4f5a6b";
const ORGANIZATION_ID = "0b7c6d5e-4f3a-4b2c-8d1e-9f0a1b2c3d4e";

function mimic(config: unknown): unknown {
  return widget({ widgetType: "mimic", gridW: 12, gridH: 6, config });
}

/**
 * `F3.32c` / ADR 0081 decision 5 — a template holds a preset mimic only. The
 * shared `dashboardWidgetSpecSchema` takes both config arms (it is the
 * dashboard's contract too), so the refusal is this package's: on `content`,
 * which both `POST` and `PATCH` carry.
 */
export function rejectsAPatchBodyWhoseMimicNamesALayout(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [mimic({ source: "layout", layoutId: LAYOUT_ID })] } },
    ["content", "widgets", 0, "config"],
    new RegExp(TEMPLATE_MIMIC_LAYOUT_MESSAGE),
    "a PATCH body whose one mimic widget names a layout",
  );
}

/** The `POST` door, the same refusal — a draft is created with its content. */
export function rejectsACreateBodyWhoseMimicNamesALayout(): void {
  expectRejectsAt(
    createDashboardTemplateBodySchema,
    {
      organizationId: ORGANIZATION_ID,
      code: "plant",
      name: "Plant",
      section: "water",
      content: { widgets: [mimic({ source: "layout", layoutId: LAYOUT_ID })] },
    },
    ["content", "widgets", 0, "config"],
    new RegExp(TEMPLATE_MIMIC_LAYOUT_MESSAGE),
    "a POST body whose one mimic widget names a layout",
  );
}

/** The positive control: the same body with the preset arm parses. */
export function acceptsAPatchBodyWhoseMimicNamesThePreset(): void {
  expectAccepts(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [mimic({ source: "preset", preset: "water_train" })] } },
    "a PATCH body whose one mimic widget names the water_train preset",
  );
}

// ---------------------------------------------------------------- F3.73

const LOCATION_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const GROUP_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function siteTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { key: "sld", label: "SLD", sortOrder: 1, domain: "electrical", widgets: [widget()], ...overrides };
}

function createBody(overrides: Record<string, unknown>): unknown {
  return { organizationId: ORGANIZATION_ID, code: "site", name: "Site", section: "site", ...overrides };
}

/** `F3.73` plan D4 — a site template holds its widgets in tabs; top-level widgets are refused. */
export function rejectsASiteCreateBodyWithTopLevelWidgets(): void {
  expectRejectsAt(
    createDashboardTemplateBodySchema,
    createBody({ target: "site", content: { widgets: [widget()], tabs: [siteTab({ widgets: [] })] } }),
    ["content", "widgets"],
    new RegExp(SITE_TEMPLATE_TOP_LEVEL_MESSAGE),
    "a site-target create body with a top-level widget",
  );
}

/** `F3.73` plan D4 — an asset-group template is one canvas; tabs are refused. */
export function rejectsAnAssetGroupCreateBodyWithTabs(): void {
  expectRejectsAt(
    createDashboardTemplateBodySchema,
    createBody({ target: "asset_group", content: { widgets: [], tabs: [siteTab()] } }),
    ["content", "tabs"],
    new RegExp(ASSET_GROUP_TEMPLATE_TABS_MESSAGE),
    "an asset-group create body with a tab",
  );
}

/** The positive control, and the default: a site body with tabs only parses; no target reads
 * as `asset_group`. */
export function acceptsASiteCreateBodyWithTabsAndDefaultsTheTarget(): void {
  expectAccepts(
    createDashboardTemplateBodySchema,
    createBody({ target: "site", content: { widgets: [], tabs: [siteTab()] } }),
    "a site-target create body whose widgets are all in tabs",
  );
  const parsed = createDashboardTemplateBodySchema.parse(createBody({}));
  assert(parsed.target === "asset_group", `an omitted target must read asset_group, got ${parsed.target}`);
}

/** `F3.32c`'s layout-arm refusal reaches tab widgets too — the same door, one level down. */
export function rejectsALayoutMimicInsideATab(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    { content: { tabs: [siteTab({ widgets: [mimic({ source: "layout", layoutId: LAYOUT_ID })] })] } },
    ["content", "tabs", 0, "widgets", 0, "config"],
    new RegExp(TEMPLATE_MIMIC_LAYOUT_MESSAGE),
    "a PATCH body whose tab holds a mimic naming a layout",
  );
}

/**
 * A `PATCH` that omits `content.tabs` parses with `tabs` still undefined, and one that sends
 * `[]` parses as `[]`: the service needs the difference to refuse an omission on a site
 * template. The create body keeps its default, because a create has no stored tabs to lose.
 */
export function aPatchBodyKeepsAnOmittedTabsUndefined(): void {
  const omitted = updateDashboardTemplateBodySchema.parse({ content: { widgets: [] } });
  assert(omitted.content?.tabs === undefined, "an omitted PATCH content.tabs must stay undefined");
  const cleared = updateDashboardTemplateBodySchema.parse({ content: { widgets: [], tabs: [] } });
  assert(
    Array.isArray(cleared.content?.tabs) && cleared.content.tabs.length === 0,
    "a PATCH content.tabs of [] must parse as []",
  );
  const created = createDashboardTemplateBodySchema.parse(createBody({ content: { widgets: [] } }));
  assert(Array.isArray(created.content?.tabs), "a create body's omitted content.tabs must default to []");
}

/** The PATCH content keeps the shared key rule: a key shared across tabs is refused there too. */
export function rejectsAPatchBodyWithADuplicateKeyAcrossTabs(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    {
      content: {
        widgets: [],
        tabs: [
          siteTab({ key: "a", widgets: [widget({ key: "same" })] }),
          siteTab({ key: "b", widgets: [widget({ key: "same" })] }),
        ],
      },
    },
    ["content", "tabs", 1, "widgets", 0, "key"],
    /duplicate widget key/,
    "a PATCH body whose two tabs share one widget key",
  );
}

/** The site arm of instantiate: a location and an optional per-tab group choice. */
export function acceptsASiteInstantiateBody(): void {
  expectAccepts(
    instantiateSectionTemplateBodySchema,
    { locationId: LOCATION_ID, tabGroups: { sld: GROUP_ID } },
    "a site instantiate body with a tab group choice",
  );
  expectAccepts(instantiateSectionTemplateBodySchema, { locationId: LOCATION_ID }, "a site body with no choice");
}

/** A body naming both arms is neither: each arm is `.strict()`, so the other arm's keys refuse it. */
export function rejectsAnInstantiateBodyNamingBothArms(): void {
  const result = instantiateSectionTemplateBodySchema.safeParse({
    assetGroupId: GROUP_ID,
    slug: "valid-slug",
    name: "x",
    locationId: LOCATION_ID,
  });
  assert(result.success === false, "a body naming both a group and a location must be refused");
}

/**
 * The body/target rule, which no schema can hold because the target is the stored row's: a
 * site body on a group template and a group body on a site template both answer
 * `TEMPLATE_TARGET_BODY_MESSAGE`, and a matching pair answers nothing.
 */
export function theTargetBodyRuleRefusesEachMismatch(): void {
  const site = instantiateSectionTemplateBodySchema.parse({ locationId: LOCATION_ID });
  const group = instantiateSectionTemplateBodySchema.parse({ assetGroupId: GROUP_ID, slug: "ok-slug", name: "x" });
  assert(
    templateTargetBodyMessage("asset_group", site) === TEMPLATE_TARGET_BODY_MESSAGE,
    "a site body on an asset-group template must be refused",
  );
  assert(
    templateTargetBodyMessage("site", group) === TEMPLATE_TARGET_BODY_MESSAGE,
    "a group body on a site template must be refused",
  );
  assert(templateTargetBodyMessage("site", site) === null, "a site body on a site template is legal");
  assert(templateTargetBodyMessage("asset_group", group) === null, "a group body on a group template is legal");
}
