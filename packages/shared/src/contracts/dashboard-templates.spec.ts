import {
  sectionTemplateContentSchema,
  sectionTemplateWidgetIdentitySchema,
  sectionTemplateWidgetSchema,
} from "./dashboard-templates";

/**
 * `F3.61` — a template widget binds asset roles or catalog sources, never
 * both (Rule 3, on `sectionTemplateWidgetIdentitySchema`), and, since
 * Amendment 1, its sources must fit its type's shape and cap, and a table's
 * `config.columns` must name only columns its bound dataset declares (three
 * more rules, on `sectionTemplateWidgetSchema`).
 *
 * One exported function per case, one `it()` per function in the sibling
 * `.test.ts` — so a failing case reddens only its own `it()` and every later
 * claim still runs. Before this split all fourteen cases sat behind two
 * `it()`s; measured, `const cap = 1` reddened case 7 alone and cases 8–13
 * never ran in the same test run (`throw` inside `assert` stops the
 * enclosing function).
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
 * so case 7 asserts the `["sources"]` issue rather than being satisfied by the deeper shape
 * issue that fires on the same parse. */
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

/** Case 1 */
export function rejectsAWidgetCarryingBothKinds(): void {
  expectRejectsAt(
    sectionTemplateWidgetSchema,
    widget({ bindings: [ROLE], sources: [METRIC] }),
    ["sources"],
    /never both/,
    "a widget carrying both kinds",
  );
}

/** Case 2 — the positive control for case 1: *Add widget*'s own shape. */
export function acceptsAWidgetCarryingNeitherKind(): void {
  expectAccepts(
    sectionTemplateWidgetSchema,
    widget({ bindings: [], sources: [] }),
    "a widget carrying neither kind",
  );
}

/** Case 3 */
export function acceptsAWidgetCarryingEitherKindAlone(): void {
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
}

/** Case 4 */
export function identitySchemaDescribesAllThreeRules(): void {
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
}

/** Case 5 — the composition the API bodies wrap. */
export function rejectsBothKindsInsideSectionTemplateContentSchema(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    { widgets: [widget({ bindings: [ROLE], sources: [METRIC] })] },
    ["widgets", 0, "sources"],
    /never both/,
    "a both-kinds widget inside sectionTemplateContentSchema",
  );
}

// ---------------------------------------------------------------------------
// Task 1b — R4 shape, R5 cap, R7 columns (Amendment 1)
// ---------------------------------------------------------------------------

const DATASET = { catalogKey: "alarms.active", params: {} };
const DATASET2 = { catalogKey: "workorders.open", params: {} };

function tile(overrides: Record<string, unknown> = {}): unknown {
  return { widgets: [widget(overrides)] };
}

function chart(overrides: Record<string, unknown> = {}): unknown {
  return {
    widgets: [
      widget({
        widgetType: "chart",
        gridW: 4,
        gridH: 3,
        config: { series: "line" },
        ...overrides,
      }),
    ],
  };
}

function tableWidget(overrides: Record<string, unknown> = {}): unknown {
  return {
    widgets: [
      widget({
        widgetType: "table",
        gridW: 4,
        gridH: 3,
        config: {},
        ...overrides,
      }),
    ],
  };
}

/** Case 6 */
export function rejectsAValueTileBoundToADataset(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    tile({ sources: [DATASET] }),
    ["widgets", 0, "sources", 0, "catalogKey"],
    /returns rows/,
    "a value_tile bound to a dataset",
  );
  const result = sectionTemplateContentSchema.safeParse(tile({ sources: [DATASET] }));
  const messages = (result.success ? [] : result.error.issues).map((i) => i.message).join(" | ");
  assert(
    /Widget "w"/.test(messages),
    `the message must name the widget key, got "${messages}"`,
  );
}

/** Case 7 — assert on ["widgets", 0, "sources"] specifically: the deeper shape
 * issue at ["widgets", 0, "sources", 0, "catalogKey"] also fires on this parse
 * and must not be what satisfies this claim. */
export function rejectsAnySourceOnAChart(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    chart({ sources: [METRIC] }),
    ["widgets", 0, "sources"],
    /at most 0/,
    "any source on a chart",
  );
}

/** Case 8 — the neighbour (case 3, one source on a tile) is the control: a
 * `>=` mutation reddens it, not this case. */
export function rejectsTwoSourcesOnAValueTile(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    tile({ sources: [METRIC, DATASET] }),
    ["widgets", 0, "sources"],
    /at most 1/,
    "two sources on a value_tile",
  );
}

/** Case 9 */
export function rejectsATableColumnItsDatasetDoesNotDeclare(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    tableWidget({ sources: [DATASET], config: { columns: ["assetCode", "nope"] } }),
    ["widgets", 0, "config", "columns", 1],
    /does not have a column named "nope"/,
    "a table column its bound dataset does not declare",
  );
}

/** Case 10 */
export function acceptsDeclaredColumnsOfTheBoundDataset(): void {
  expectAccepts(
    sectionTemplateContentSchema,
    tableWidget({ sources: [DATASET2], config: { columns: ["status", "dueAt"] } }),
    "declared columns of the bound dataset (workorders.open, not alarms.active's)",
  );
}

/** Case 11 */
export function rejectsTheSameColumnChosenTwice(): void {
  expectRejectsAt(
    sectionTemplateContentSchema,
    tableWidget({ sources: [DATASET], config: { columns: ["assetCode", "assetCode"] } }),
    ["widgets", 0, "config", "columns", 1],
    /already chosen/,
    "the same column chosen twice",
  );
}

/** Case 12 — the state Task 4's remove control produces (§11.2.3: no minimum). */
export function acceptsATableWithNoSourceAndNoColumns(): void {
  expectAccepts(
    sectionTemplateContentSchema,
    tableWidget(),
    "a table with no source and no columns",
  );
}

/** The R7 guard (dashboards.schema.ts:582-588's own load-bearing guard,
 * mirrored here): `config.columns` set with no source bound must not throw
 * out of `safeParse`. Not a numbered plan case — found reviewing the guard
 * while building R7, reported per the caller's TDD instruction. Kept as its
 * own case (not folded into case 12): it asserts a different failure mode
 * (no throw) than case 12's success-parse claim. */
export function tableWithColumnsSetButNoSourceDoesNotThrow(): void {
  const result = sectionTemplateContentSchema.safeParse(
    tableWidget({ config: { columns: ["assetCode"] } }),
  );
  assert(
    result.success === true,
    "a table with config.columns set but no source must not throw out of safeParse " +
      `(the R7 early-return guard) — got ${JSON.stringify(result.success ? null : result.error.issues)}`,
  );
}

/** Case 13 */
export function widgetSchemaDescribesShapeCapAndColumnsRules(): void {
  assert(
    typeof sectionTemplateWidgetSchema.description === "string",
    "sectionTemplateWidgetSchema must carry a .describe() after its superRefine " +
      "(ADR 0029 Amendment 1 fact F)",
  );
  const description = sectionTemplateWidgetSchema.description ?? "";
  assert(/shape/.test(description), `the description must name the shape rule, got "${description}"`);
  assert(/at most/.test(description), `the description must name the cap rule, got "${description}"`);
  assert(/columns/.test(description), `the description must name the columns rule, got "${description}"`);
}
