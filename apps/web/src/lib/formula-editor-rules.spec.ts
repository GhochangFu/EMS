/**
 * The editor's rules (`F2.5`, ADR 0038 — Unit 5).
 *
 * These assertions exist because the code they cover used to live in
 * `formula-editor.tsx`, where no test in this repository can reach it: the
 * `apps/web` Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, and the coverage gate does not look above `src/lib`.
 */
import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";
import type { TemplateKpi } from "@bms/shared";

import {
  EMPTY_DERIVED_FORMULA_MESSAGE,
  EMPTY_KPI_EXPRESSION_MESSAGE,
  completionKeys,
  decorationDialect,
  editorDiagnosticRanges,
  flattenNewlines,
  isCheckedDialect,
  validateEditorFormula,
  type FormulaEditorRules,
} from "./formula-editor-rules";
import type { FormulaPoint } from "./template-formula-validation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `A` and `B` measured, `D` and `SELF` derived. */
const POINTS: FormulaPoint[] = [
  { pointKey: "A", kind: "measured" },
  { pointKey: "B", kind: "measured" },
  { pointKey: "D", kind: "derived" },
  { pointKey: "SELF", kind: "derived" },
];

const DERIVED: FormulaEditorRules = {
  mode: "derived",
  points: POINTS,
  selfPointKey: "D",
  dialect: CALC_DIALECT,
};

function kpi(dialect: TemplateKpi["dialect"], kpiPointKeys: string[] = ["A"]): FormulaEditorRules {
  return { mode: "kpi", declaredPointKeys: ["A", "B"], kpiPointKeys, dialect };
}

/**
 * An empty derived formula is an error, not a silence.
 *
 * `asset-templates.schema.ts:58` refuses a derived point whose `formula` is
 * absent or empty. A field that says nothing here lets the author press Save
 * and read the rule out of a 400 — the one failure this whole client layer
 * exists to prevent.
 */
export function runEmptyDerivedFormulaTests(): void {
  for (const text of ["", "   ", "\t"]) {
    const result = validateEditorFormula(DERIVED, text);
    assert(
      result.state === "error",
      `${JSON.stringify(text)} must be an error, got ${JSON.stringify(result)}`,
    );
    if (result.state !== "error") {
      return;
    }
    assert(
      result.diagnostics[0].message === EMPTY_DERIVED_FORMULA_MESSAGE,
      `must name the requirement, got: ${result.diagnostics[0].message}`,
    );
    assert(
      !result.diagnostics[0].message.includes("character"),
      "must not fall through to the parser's positional message",
    );
  }
}

/**
 * An empty KPI expression is an error **even at `dialect: "unvalidated"`**.
 *
 * ADR 0038 decision 9 protects a stored expression the author did not touch,
 * and `templateKpiSchema` declares `expression: z.string().min(1)` — so no
 * stored expression is ever empty. An empty field is one the author just
 * cleared, and it will fail to save whatever the dialect says.
 */
export function runEmptyKpiExpressionTests(): void {
  for (const dialect of ["unvalidated", "bms-calc-v1"] as const) {
    const result = validateEditorFormula(kpi(dialect), "  ");
    assert(
      result.state === "error",
      `an empty expression at dialect ${dialect} must be an error, got ${JSON.stringify(result)}`,
    );
    if (result.state !== "error") {
      return;
    }
    assert(
      result.diagnostics[0].message === EMPTY_KPI_EXPRESSION_MESSAGE,
      `must name the requirement, got: ${result.diagnostics[0].message}`,
    );
  }
}

/** A non-empty `"unvalidated"` KPI is still left alone (decision 9). */
export function runUnvalidatedKpiStillSilentTests(): void {
  const result = validateEditorFormula(kpi("unvalidated"), "whatever ###");
  assert(
    result.state === "unvalidated",
    `a stored unvalidated expression must stay unvalidated, got ${JSON.stringify(result)}`,
  );
  assert(!isCheckedDialect(kpi("unvalidated")), "an unvalidated KPI is not a checked dialect");
  assert(isCheckedDialect(kpi("bms-calc-v1")), "a bms-calc-v1 KPI is checked");
  // `F2.9` — a real dialect, resolved against the vocabulary rather than
  // compared to the `v1` literal. This says the row is not free text; it does
  // **not** say a `v2` expression is checked, which is Task 15's work.
  assert(isCheckedDialect(kpi(CALC_DIALECT_V2)), "a bms-calc-v2 KPI is not free text either");
  assert(isCheckedDialect(DERIVED), "a derived formula is always checked");
}

/** Non-empty text routes to the right validator on each surface. */
export function runRoutesToTheRightValidatorTests(): void {
  const derived = validateEditorFormula(DERIVED, "{SELF} + 1");
  assert(derived.state === "error", "a derived formula may not reference a derived point");
  if (derived.state === "error") {
    assert(
      derived.diagnostics[0].message.includes("may only reference measured points"),
      `must be the derived-reference rule, got: ${derived.diagnostics[0].message}`,
    );
  }

  const unused = validateEditorFormula(kpi("bms-calc-v1", ["A", "B"]), "{A}");
  assert(unused.state === "error", "an unused pointKeys entry must be an error");
  if (unused.state === "error") {
    assert(
      unused.diagnostics[0].message.includes("pointKeys"),
      `must be the two-way pointKeys rule, got: ${unused.diagnostics[0].message}`,
    );
  }

  const ok = validateEditorFormula(DERIVED, "({A} + {B}) / 2");
  assert(ok.state === "ok", `a valid formula must pass, got ${JSON.stringify(ok)}`);
}

/**
 * Completion offers measured siblings only, minus the point being edited.
 *
 * This is ADR 0038 decision 7's stated reason for taking
 * `@codemirror/autocomplete`: completion prevents the error instead of
 * reporting it. Offering `D` or `SELF` would be worse than offering nothing —
 * the author picks the suggestion and the field underlines it immediately.
 */
export function runCompletionKeyTests(): void {
  const derived = completionKeys(DERIVED);
  assert(
    derived.join(",") === "A,B",
    `derived mode must offer measured siblings only, got ${JSON.stringify(derived)}`,
  );
  assert(!derived.includes("D"), "must not offer the point being edited");
  assert(!derived.includes("SELF"), "must not offer another derived point");

  const self = completionKeys({
    mode: "derived",
    points: POINTS,
    selfPointKey: "A",
    dialect: CALC_DIALECT,
  });
  assert(
    self.join(",") === "B",
    `editing measured point A must not offer A itself, got ${JSON.stringify(self)}`,
  );

  const kpiKeys = completionKeys(kpi("bms-calc-v1"));
  assert(
    kpiKeys.join(",") === "A,B",
    `KPI mode offers every declared key, got ${JSON.stringify(kpiKeys)}`,
  );
}

/**
 * Under `bms-calc-v2` completion offers every sibling except the point being
 * edited.
 *
 * The `v1` filter exists because ADR 0036 decision 7 makes a derived sibling an
 * error the moment it is picked — offering it would be worse than offering
 * nothing. ADR 0055 decision 7 repeals that ban for `v2`, so under `v2` the
 * same filter hides keys the server now accepts.
 *
 * Self is still excluded under both. `v2` repealed the sibling ban, not the
 * self-reference one — a formula that reads itself is a cycle, which Task 12
 * refuses at save.
 *
 * The `v1` half is re-asserted here beside it: a gate that only ever widens is
 * not a gate, and this is the assertion that reddens if the dialect condition
 * is inverted rather than dropped.
 */
export function runV2CompletionKeyTests(): void {
  const v2 = completionKeys({
    mode: "derived",
    points: POINTS,
    selfPointKey: "SELF",
    dialect: CALC_DIALECT_V2,
  });
  assert(
    v2.join(",") === "A,B,D",
    `v2 offers every sibling except self, got ${JSON.stringify(v2)}`,
  );
  assert(v2.includes("D"), "v2 must offer the derived sibling D — ADR 0055 decision 7");
  assert(!v2.includes("SELF"), "v2 must still not offer the point being edited");

  const v1 = completionKeys({
    mode: "derived",
    points: POINTS,
    selfPointKey: "SELF",
    dialect: CALC_DIALECT,
  });
  assert(
    v1.join(",") === "A,B",
    `v1 still offers measured siblings only, got ${JSON.stringify(v1)}`,
  );
}

/**
 * Ranges are clamped into the document, and invisible ones are widened.
 *
 * A range past the end makes CodeMirror throw. A zero-width range renders
 * nothing at all, which looks exactly like a field with no problem.
 */
export function runDiagnosticRangeTests(): void {
  const clamped = editorDiagnosticRanges([{ message: "m", from: 2, to: 99 }], 7);
  assert(clamped[0].from === 2, `from must stay 2, got ${clamped[0].from}`);
  assert(clamped[0].to === 7, `to must clamp to the document length 7, got ${clamped[0].to}`);

  const negative = editorDiagnosticRanges([{ message: "m", from: -5, to: 3 }], 7);
  assert(negative[0].from === 0, `a negative from must clamp to 0, got ${negative[0].from}`);

  const widened = editorDiagnosticRanges([{ message: "m", from: 4, to: 4 }], 7);
  assert(widened[0].to === 4, `to must stay 4, got ${widened[0].to}`);
  assert(widened[0].from === 3, `a zero-width mark must widen back to 3, got ${widened[0].from}`);

  // At offset 0 there is no character to widen back into. It stays zero-width
  // rather than inverting, which would be a range CodeMirror rejects.
  const atStart = editorDiagnosticRanges([{ message: "m", from: 0, to: 0 }], 0);
  assert(atStart[0].from === 0 && atStart[0].to === 0, "an empty document keeps a 0..0 range");

  // An inverted input cannot produce an inverted output.
  const inverted = editorDiagnosticRanges([{ message: "m", from: 6, to: 2 }], 7);
  assert(
    inverted[0].to >= inverted[0].from,
    `to must never fall below from, got ${inverted[0].from}..${inverted[0].to}`,
  );
}

/**
 * The dialect the editor highlights with.
 *
 * This is the half `isCheckedDialect`'s docblock used to record as outstanding:
 * `formula-editor.tsx` called `calcDecorations` with no dialect, so a `v2`
 * formula lexed as `v1`, stopped at the `@`, and rendered unstyled from there
 * on. The author then sees plain text where every other formula is coloured and
 * reads a correct formula as broken.
 *
 * `"unvalidated"` is not a grammar, so it falls back to `v1` — which is what
 * **Validate this expression** attempts first. It is only reachable when
 * `isCheckedDialect` has already suppressed highlighting, and is asserted here
 * so a later caller cannot hand that string to `tokenize` as if it named one.
 */
export function runDecorationDialectTests(): void {
  assert(
    decorationDialect({ ...DERIVED, dialect: CALC_DIALECT_V2 }) === CALC_DIALECT_V2,
    "a v2 derived formula must be lexed as v2, or its scope and string runs render unstyled",
  );
  assert(decorationDialect(DERIVED) === CALC_DIALECT, "a v1 derived formula is lexed as v1");
  assert(
    decorationDialect(kpi(CALC_DIALECT_V2)) === CALC_DIALECT_V2,
    "the Q3 ruling widened the KPI dialect, so a v2 KPI must be lexed as v2 too",
  );
  assert(
    decorationDialect(kpi("unvalidated")) === CALC_DIALECT,
    'an "unvalidated" KPI is not a grammar and must never reach tokenize as one',
  );
}

/**
 * Newline flattening preserves length, one character for one.
 *
 * That property is what lets the caller rewrite a transaction without
 * recomputing the selection. If a `\r\n` collapsed to a single space, every
 * offset after it would shift and the cursor would land in the wrong place.
 */
export function runFlattenNewlinesTests(): void {
  assert(flattenNewlines("{A}\n+ {B}") === "{A} + {B}", "a newline becomes a space");
  assert(flattenNewlines("{A}\r\n+1") === "{A}  +1", "CRLF becomes two spaces, not one");

  for (const text of ["{A}\n+{B}", "a\r\nb\rc\nd", "no newlines here"]) {
    assert(
      flattenNewlines(text).length === text.length,
      `length must be preserved for ${JSON.stringify(text)}`,
    );
    assert(!/[\r\n]/.test(flattenNewlines(text)), "no newline may survive");
  }
}
