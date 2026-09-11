/**
 * The within-template cycle mirror (`F2.22` item 7, the owner's Q5 ruling).
 *
 * The three fixtures are the server's own, transposed from
 * `asset-templates.schema.spec.ts` `runTemplateCycleGuardTests`: a two-point
 * `bms-calc-v2` cycle, a site sum over the point's own key, and a `v2` point
 * reading a measured sibling. Two more are this module's: the one-edge
 * self-reference `{SELF}` under `v2`, which no client check reported before
 * this module (the plan's finding 3 — its anti-vacuity case), and a `v1` pair,
 * which is the linter's refusal and not this module's.
 */
import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";

import { templateCycleProblems } from "./template-calc-cycles";
import type { TemplatePointRow } from "./template-points-grid";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function point(overrides: Partial<TemplatePointRow>): TemplatePointRow {
  return {
    pointKey: "A",
    label: "",
    unit: "",
    kind: "measured",
    sourceDataKeyPattern: "",
    required: false,
    sortOrder: 0,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    meta: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

/** A scheduled `bms-calc-v2` derived point — the shape the server accepts. */
function v2Point(pointKey: string, formula: string): TemplatePointRow {
  return point({
    pointKey,
    kind: "derived",
    formula,
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
  });
}

function v1Point(pointKey: string, formula: string): TemplatePointRow {
  return point({
    pointKey,
    kind: "derived",
    formula,
    formulaDialect: CALC_DIALECT,
    calcTrigger: "streaming",
  });
}

function describeProblems(problems: readonly { row: number | null; field: string; message: string }[]): string {
  return JSON.stringify(problems.map((problem) => ({ row: problem.row, field: problem.field })));
}

/**
 * Two `v2` points referencing each other: reported at both, on `formula`, each
 * naming both members, each saying what it cannot rule out.
 */
export function runTwoPointCycleTests(): void {
  const rows = [v2Point("D", "{E}"), v2Point("E", "{D}")];
  const problems = templateCycleProblems(rows);
  assert(
    problems.length === 2,
    "a two-point cycle must be reported at both points — either is a legitimate place to " +
      `break it, and neither is more at fault. Got: ${describeProblems(problems)}`,
  );
  assert(
    problems.every((problem) => problem.field === "formula"),
    `each cycle problem must land on the formula field that forms it, got: ${describeProblems(problems)}`,
  );
  assert(
    problems.map((problem) => problem.row).join(",") === "0,1",
    `addressed by the row index the tab renders by, in row order — got ${describeProblems(problems)}`,
  );
  assert(
    problems.every((problem) => problem.message.includes("D") && problem.message.includes("E")),
    `the message must name the cycle's members so the author can break it, got: ${problems[0]?.message}`,
  );
  // The members as a list, in row order — the server joins `members` with
  // `", "`, and the tab shows this string as it is.
  assert(
    problems.every((problem) => problem.message.includes("The points on it are: D, E.")),
    `the member list is the server's shape — got: ${problems[0]?.message}`,
  );
  // Plan correction 52 of `F2.9`: the check sees only this template's points,
  // and the message must not read as "this template has no cycles".
  assert(
    problems.every((problem) => problem.message.includes("cannot rule out")),
    "the message must say what it found, not what it ruled out — a template has no location, " +
      `so @domain, @group and {CODE.key} resolve to nothing here. Got: ${problems[0]?.message}`,
  );
}

/**
 * A site sum that includes the point's own key is a one-edge cycle — the
 * declaring asset is a member of its own site. The `{T}` inside the aggregate
 * is a **cross** reference, not a local one (`parseFormula` returns it under
 * `crossRefs`), so this is the case only the aggregate edge reaches: drop that
 * edge and this suite reddens while the two-point one stays green.
 */
export function runSelfAggregateTests(): void {
  const problems = templateCycleProblems([v2Point("T", "sum({T} @site)")]);
  assert(
    problems.length === 1 && problems[0].field === "formula" && problems[0].row === 0,
    `a site sum over the point's own key is a one-edge cycle — got ${describeProblems(problems)}`,
  );
  assert(
    problems[0].message.includes("The points on it are: T."),
    `a one-edge cycle names its one member — got ${problems[0].message}`,
  );

  // The other two scopes resolve to nothing on a template (no location, no
  // group), so the same shape over `@domain` or `@group` draws no edge — the
  // server's `templateCycles` says exactly this, and the tick is the authority.
  for (const scope of ['@domain("d")', '@group("g")']) {
    const none = templateCycleProblems([v2Point("T", `sum({T} ${scope})`)]);
    assert(
      none.length === 0,
      `${scope} resolves to nothing on a template, so it is not a cycle here — got ${describeProblems(none)}`,
    );
  }

  // A site sum over a *measured* sibling's key is not an edge either: a
  // measured point is not computed by the engine and cannot wait on anything.
  const measuredMember = templateCycleProblems([point({ pointKey: "kw" }), v2Point("T", "sum({kw} @site)")]);
  assert(
    measuredMember.length === 0,
    `a site sum over a measured key is not a cycle — got ${describeProblems(measuredMember)}`,
  );
}

/** A `v2` point reading a measured sibling: no cycle, and no refusal for being `v2`. */
export function runMeasuredSiblingTests(): void {
  const problems = templateCycleProblems([point({ pointKey: "A" }), v2Point("D", "{A}")]);
  assert(
    problems.length === 0,
    "a bms-calc-v2 point referencing a measured sibling is no cycle, and the check must not " +
      `refuse a v2 formula merely for being one. Got: ${describeProblems(problems)}`,
  );

  // A layered chain (decision 7) is not a cycle: D reads E, E reads A.
  const chain = templateCycleProblems([point({ pointKey: "A" }), v2Point("E", "{A} * 2"), v2Point("D", "{E}")]);
  assert(chain.length === 0, `a chain without a loop is not a cycle — got ${describeProblems(chain)}`);

  // A point that does not parse is skipped: the linter already refuses it,
  // and a second message calling it a cycle would be wrong.
  const broken = templateCycleProblems([v2Point("D", "{D} +"), v2Point("E", "{E}")]);
  assert(
    broken.length === 1 && broken[0].row === 1,
    `an unparseable formula is not a node — only the parseable self-loop is reported. Got ${describeProblems(broken)}`,
  );
}

/**
 * **The anti-vacuity case.** `{SELF}` under `v2` reached the server before this
 * module existed: `validateDerivedFormula` returns `ok` for `v2` before its
 * derived-reference scan and `brokenFormulaRefs` refuses only under `v1`, so no
 * client check said anything (the plan's finding 3). The server refuses it as a
 * one-edge cycle, and now so does this.
 */
export function runSelfReferenceTests(): void {
  const problems = templateCycleProblems([point({ pointKey: "A" }), v2Point("D", "{D} + {A}")]);
  assert(
    problems.length === 1 && problems[0].field === "formula" && problems[0].row === 1,
    `a v2 self-reference is a one-edge cycle — got ${describeProblems(problems)}`,
  );
  assert(
    problems[0].message.includes("The points on it are: D."),
    `and names the one member — got ${problems[0].message}`,
  );
}

/**
 * A `v1` pair is not this module's. Under `v1` a local reference to a derived
 * point is refused by the linter (`runDerivedReferenceTests`) and by
 * `brokenFormulaRefs` on the Points tab, on the same `formula` field — and the
 * tab renders the first problem per field. A `v1` formula has no cross
 * references, so a `v1` row's only edges are local refs, every one of which to
 * a derived row is already a blocking refusal on that row: leaving `v1` rows
 * out of the graph cannot let a save through that the server refuses.
 */
export function runV1PairIsTheLintersTests(): void {
  const problems = templateCycleProblems([v1Point("D", "{E}"), v1Point("E", "{D}")]);
  assert(
    problems.length === 0,
    `a v1 pair is the derived-reference refusal's, not a cycle report — got ${describeProblems(problems)}`,
  );

  // The positive control on the same shape: the same pair under `v2` is the
  // cycle, so the `v1` silence above is the dialect's and not a dead scan.
  const underV2 = templateCycleProblems([v2Point("D", "{E}"), v2Point("E", "{D}")]);
  assert(underV2.length === 2, `the same pair under v2 is reported — got ${describeProblems(underV2)}`);

  // A row whose stored dialect is unknown resolves to `v1` (`rowDialect`), so
  // it is not a node either — the same fallback `brokenFormulaRefs` makes.
  const unknown = templateCycleProblems([
    point({ pointKey: "D", kind: "derived", formula: "{D}", formulaDialect: "bms-calc-v9" as TemplatePointRow["formulaDialect"] }),
  ]);
  assert(unknown.length === 0, `an unknown dialect falls back to v1 and is not a node — got ${describeProblems(unknown)}`);
}
