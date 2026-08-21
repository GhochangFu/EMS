/**
 * The editor's rules (`F2.5`, ADR 0038 — Unit 5).
 *
 * These assertions exist because the code they cover used to live in
 * `formula-editor.tsx`, where no test in this repository can reach it: the
 * `apps/web` Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, and the coverage gate does not look above `src/lib`.
 */
import type { TemplateKpi } from "@bms/shared";

import {
  EMPTY_DERIVED_FORMULA_MESSAGE,
  EMPTY_KPI_EXPRESSION_MESSAGE,
  completionKeys,
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

const DERIVED: FormulaEditorRules = { mode: "derived", points: POINTS, selfPointKey: "D" };

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

  const self = completionKeys({ mode: "derived", points: POINTS, selfPointKey: "A" });
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
