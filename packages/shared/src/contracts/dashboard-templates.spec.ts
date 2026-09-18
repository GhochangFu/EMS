import {
  sectionTemplateContentSchema,
  sectionTemplateWidgetIdentitySchema,
  sectionTemplateWidgetSchema,
} from "./dashboard-templates";

/**
 * `F3.61` — a template widget binds asset roles or catalog sources, never
 * both (Rule 3, on `sectionTemplateWidgetIdentitySchema`).
 *
 * Assertions live here; `dashboard-templates.test.ts` is the vitest entry
 * point (ADR 0014).
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

/** Asserts the schema refuses `value` with an issue whose `path` matches exactly, and whose
 * message matches `pattern`. Ported from `apps/api/src/dashboard-builder/dashboards.schema.spec.ts`
 * so case 1 asserts the `["sources"]` issue precisely. */
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

// ---------------------------------------------------------------------------
// Task 1 — Rule 3: never both kinds
// ---------------------------------------------------------------------------

const ROLE = { assetRoleCode: "meter", pointKey: "kw" };
const METRIC = { catalogKey: "alarms.active.count", params: {} };

/** A legal `value_tile` identity + spec object, overridable. */
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

export function runSectionTemplateWidgetIdentityTests(): void {
  // Case 1
  expectRejectsAt(
    sectionTemplateWidgetSchema,
    widget({ bindings: [ROLE], sources: [METRIC] }),
    ["sources"],
    /never both/,
    "a widget carrying both kinds",
  );

  // Case 2 — the positive control for case 1: *Add widget*'s own shape.
  expectAccepts(
    sectionTemplateWidgetSchema,
    widget({ bindings: [], sources: [] }),
    "a widget carrying neither kind",
  );

  // Case 3
  expectAccepts(
    sectionTemplateWidgetSchema,
    widget({ bindings: [ROLE] }),
    "a widget carrying only a role binding",
  );
  expectAccepts(
    sectionTemplateWidgetSchema,
    widget({ sources: [METRIC] }),
    "a widget carrying only a catalog source",
  );

  // Case 4
  assert(
    typeof sectionTemplateWidgetIdentitySchema.description === "string",
    "sectionTemplateWidgetIdentitySchema must carry a .describe() after its superRefine " +
      "(ADR 0029 Amendment 1 fact F)",
  );
  const description = sectionTemplateWidgetIdentitySchema.description ?? "";
  assert(/canvas/.test(description), `the description must name the grid-fit rule, got "${description}"`);
  assert(
    /same asset role/.test(description),
    `the description must name the duplicate-binding rule, got "${description}"`,
  );
  assert(
    /never both/.test(description),
    `the description must name the never-both rule, got "${description}"`,
  );

  // Case 5 — the composition the API bodies wrap.
  expectRejectsAt(
    sectionTemplateContentSchema,
    { widgets: [widget({ bindings: [ROLE], sources: [METRIC] })] },
    ["widgets", 0, "sources"],
    /never both/,
    "a both-kinds widget inside sectionTemplateContentSchema",
  );
}
