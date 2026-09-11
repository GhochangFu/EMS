/**
 * The editor's rules (`F2.5`, ADR 0038 — Unit 5).
 *
 * These assertions exist because the code they cover used to live in
 * `formula-editor.tsx`, where no test in this repository can reach it: the
 * `apps/web` Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, and the coverage gate does not look above `src/lib`.
 */
import { CALC_DIALECT, CALC_DIALECT_V2, CALC_SCOPE_KINDS, parseFormula } from "@bms/shared";
import type { TemplateKpi } from "@bms/shared";

import {
  EMPTY_DERIVED_FORMULA_MESSAGE,
  EMPTY_KPI_EXPRESSION_MESSAGE,
  V2_REFERENCE_FORMS,
  completionKeys,
  decorationDialect,
  editorDiagnosticRanges,
  flattenNewlines,
  isCheckedDialect,
  scopeCompletions,
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
 * `@` completion offers one scope per `CALC_SCOPE_KINDS` member on a `v2`
 * derived formula, and nothing on a `v1` one (`F2.22` T5, ADR 0055 decision 1).
 *
 * The list is compared to the constant, **not** to three literals: the claim
 * is "every scope the grammar admits", and a fourth member added to the
 * constant must redden this the moment it lands. A label carries the trailing
 * `(` for the two scopes that take a code, so the comparison strips it — the
 * exact shape of `apply` is its own assertion below, and `site`'s label is
 * asserted whole because it is the one that must **not** carry a paren.
 *
 * `v1` has no `@` at all (`tokenizer.ts` admits a scope under `v2` only), so
 * offering one there would insert text the linter underlines at once — the
 * same failure the `v1` sibling filter in `completionKeys` exists to prevent.
 */
export function runScopeCompletionTests(): void {
  const v2 = scopeCompletions({ ...DERIVED, dialect: CALC_DIALECT_V2 });
  assert(
    v2.length === CALC_SCOPE_KINDS.length,
    `v2 must offer every scope kind (${CALC_SCOPE_KINDS.length}), got ${v2.length}`,
  );
  const bareLabels = v2.map((scope) => scope.label.replace(/\($/, "")).join(",");
  const expected = CALC_SCOPE_KINDS.map((kind) => `@${kind}`).join(",");
  assert(
    bareLabels === expected,
    `labels must be "@" + each CALC_SCOPE_KINDS member in order, got ${bareLabels}`,
  );
  const site = v2.find((scope) => scope.label === "@site");
  assert(site !== undefined, "@site takes no code, so its label is exactly @site");
  assert(site?.apply === "@site", `@site applies as itself, got ${JSON.stringify(site?.apply)}`);
  for (const kind of CALC_SCOPE_KINDS.filter((candidate) => candidate !== "site")) {
    const scope = v2.find((candidate) => candidate.label === `@${kind}(`);
    assert(scope !== undefined, `@${kind} takes a code, so its label ends with "("`);
    assert(
      scope?.apply === `@${kind}('`,
      `@${kind} must apply with its opening quote, got ${JSON.stringify(scope?.apply)}`,
    );
  }
  for (const scope of v2) {
    assert(scope.info.length > 0, `${scope.label} must carry a one-line info`);
    assert(!scope.info.includes("\n"), `${scope.label}'s info must stay on one line`);
  }

  const v1 = scopeCompletions(DERIVED);
  assert(v1.length === 0, `v1 has no @ scopes, got ${JSON.stringify(v1)}`);
}

/**
 * The KPI arm is gated on the same dialect, not on the surface.
 *
 * Kept apart from the derived arm so that a gate written as `mode ===
 * "derived"` reddens **this** suite by name — in one suite the derived-arm
 * assertion would throw first and the KPI claim would never run. A KPI at
 * `"unvalidated"` is free text (ADR 0038 decision 9) and gets nothing; a KPI
 * at `v2` (the owner's Q3 ruling, ADR 0055 decision 2) gets every scope.
 */
export function runKpiScopeCompletionTests(): void {
  const unvalidated = scopeCompletions(kpi("unvalidated"));
  assert(
    unvalidated.length === 0,
    `an "unvalidated" KPI is not a grammar and gets no scopes, got ${JSON.stringify(unvalidated)}`,
  );
  const v2 = scopeCompletions(kpi(CALC_DIALECT_V2));
  assert(
    v2.length === CALC_SCOPE_KINDS.length,
    `a v2 KPI must offer every scope kind (${CALC_SCOPE_KINDS.length}), got ${v2.length}`,
  );
  const v1 = scopeCompletions(kpi(CALC_DIALECT));
  assert(v1.length === 0, `a v1 KPI has no @ scopes, got ${JSON.stringify(v1)}`);
}

/**
 * The two reference forms ADR 0055 decision 6 buys, and the examples that
 * teach them.
 *
 * Exactly two, named: an aggregate answers a total or ratio over a set, a
 * qualified reference answers a balance between named assets (Q1's ruling —
 * "each form answers one of them"). A third entry would be a third form the
 * grammar does not carry.
 *
 * Each example is **grammar, not prose**: it is parsed under `v2` here, and
 * the parse must yield a cross reference of the kind the form names — an
 * `aggregate` node for the aggregate, a `qref` for the qualified form — so a
 * later grammar change cannot leave the tabs teaching a formula the parser
 * refuses, or one that teaches the other form.
 *
 * The negative control is **not** "fails under `v1`". The qualified example
 * parses under `v1` too, as a local reference to a point key named
 * `TX_01.kwh` (a `v1` key may hold anything except a brace), so a parse
 * failure would be the wrong discriminator. What `v1` can never produce is a
 * cross reference, so the control is `crossRefs` empty under `v1` — refused or
 * read as local, either way the example means something else there.
 */
export function runReferenceFormsTests(): void {
  assert(
    V2_REFERENCE_FORMS.length === 2,
    `decision 6 buys two forms, got ${V2_REFERENCE_FORMS.length}`,
  );
  const forms = V2_REFERENCE_FORMS.map((entry) => entry.form).join(",");
  assert(forms === "aggregate,qualified", `the forms are aggregate then qualified, got ${forms}`);
  const nodeKindByForm = { aggregate: "aggregate", qualified: "qref" } as const;
  for (const entry of V2_REFERENCE_FORMS) {
    const v2 = parseFormula(entry.example, { dialect: CALC_DIALECT_V2 });
    assert(
      v2.ok,
      `the ${entry.form} example ${JSON.stringify(entry.example)} must parse under v2: ${
        v2.ok ? "" : JSON.stringify(v2.errors)
      }`,
    );
    const kinds = v2.ok ? v2.crossRefs.map((node) => node.kind) : [];
    assert(
      kinds.length > 0 && kinds.every((kind) => kind === nodeKindByForm[entry.form]),
      `the ${entry.form} example must read only ${nodeKindByForm[entry.form]} cross references, got ${JSON.stringify(kinds)}`,
    );
    assert(
      v2.ok && v2.refs.length === 0,
      `the ${entry.form} example teaches a cross-asset form, so it must read no local point`,
    );
    const v1 = parseFormula(entry.example, { dialect: CALC_DIALECT });
    assert(
      !v1.ok || v1.crossRefs.length === 0,
      `v1 has no cross-asset form, so the ${entry.form} example must yield none there — the gate would be vacuous`,
    );
    assert(entry.answers.length > 0, `the ${entry.form} form must say what it answers`);
  }
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
