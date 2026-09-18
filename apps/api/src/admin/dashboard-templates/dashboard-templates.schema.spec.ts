import { updateDashboardTemplateBodySchema } from "./dashboard-templates.schema";

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

export function runUpdateBodyTemplateSourceRulesTests(): void {
  expectRejectsAt(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [widget({ bindings: [ROLE], sources: [METRIC] })] } },
    ["content", "widgets", 0, "sources"],
    /never both/,
    "a PATCH body whose one widget carries both kinds",
  );

  // Adjacent positive control — the same body shape, legal.
  expectAccepts(
    updateDashboardTemplateBodySchema,
    { content: { widgets: [widget({ sources: [] })] } },
    "a PATCH body whose widget carries neither kind",
  );

  // Amendment 1 — the second node reaches the boundary the same way.
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
