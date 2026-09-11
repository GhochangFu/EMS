/**
 * The editor's own rules, separated from its wiring (`F2.5`, ADR 0038 —
 * Unit 5).
 *
 * `formula-editor.tsx` cannot hold these. `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**\/*.test.ts`, so a `.tsx` is not reachable
 * by a test at all, and the coverage gate's `include` reaches
 * `apps/web/src/lib/**` and nothing above it. Logic left in the component is
 * both untestable and invisible — the same reasoning
 * `template-formula-validation.ts` records, applied to the component that
 * consumes it.
 *
 * What lives here is everything that answers a question. What stays in the
 * `.tsx` is everything that talks to CodeMirror.
 */
import { CALC_DIALECT, CALC_DIALECT_V2, CALC_DIALECTS, CALC_SCOPE_KINDS } from "@bms/shared";
import type { CalcDialect, TemplateKpi } from "@bms/shared";

import {
  validateDerivedFormula,
  validateKpiExpression,
  type FormulaDiagnostic,
  type FormulaPoint,
  type FormulaValidation,
} from "./template-formula-validation";

/**
 * Which surface is being edited, and what it needs.
 *
 * A discriminated union rather than one `resolvableKeys: string[]`, because a
 * single key list cannot serve both arms. `validateDerivedFormula` needs each
 * sibling's **kind** — ADR 0036 decision 7 forbids derived-to-derived chaining
 * — and needs to know which point is being edited, so that a self-reference
 * gets its own message. The KPI arm needs two separate lists that must agree in
 * both directions, plus the dialect that decides whether it is checked at all.
 *
 * The component's props are this union plus `value`, `onChange` and `readOnly`.
 */
export type FormulaEditorRules =
  | {
      mode: "derived";
      /** Every point this template declares, with its kind. */
      points: readonly FormulaPoint[];
      /** The point being edited. Referencing it is a self-reference. */
      selfPointKey: string;
      /**
       * The dialect **this formula is stored under** (`F2.9`, ADR 0055).
       *
       * Required, with no default. Two rules read it — the derived-reference
       * refusal and what `{` completion offers — and both are wrong in opposite
       * directions if a caller forgets it: a `v2` formula would be underlined
       * for references the server accepts, and its author would be offered a
       * narrower set of keys than exists. A required field turns "forgot to
       * thread it" into a compile error, which is the only place it is cheap.
       *
       * The KPI arm's `dialect` below is a different type on purpose — it
       * carries `"unvalidated"`, which a point's `formulaDialect` never does.
       */
      dialect: CalcDialect;
    }
  | {
      mode: "kpi";
      /** The keys `points[]` declares — the `findUnresolvedContentRefs` half. */
      declaredPointKeys: readonly string[];
      /** The KPI's own `pointKeys`, cross-checked in both directions. */
      kpiPointKeys: readonly string[];
      /** `"unvalidated"` suppresses the parser checks (ADR 0038 decision 9). */
      dialect: TemplateKpi["dialect"];
    };

/**
 * The two empty-field messages.
 *
 * These are **not** copies of the server's, and that is deliberate — unlike the
 * three messages in `template-formula-validation.ts`, which are copied
 * verbatim. The server's derived message is `A derived point requires
 * "formula" and a formulaDialect of "bms-calc-v1" or "bms-calc-v2"` — built
 * from `CALC_DIALECTS` at `asset-templates.schema.ts:122`, so it names every
 * dialect the server admits — and its KPI equivalent is a bare Zod `too_small`
 * on `expression`. Neither is something an author can act on: `formulaDialect`
 * is a field the dialect control sets and no one types.
 *
 * So these say the actionable half. The rule they mirror is exact even though
 * the wording is not, and a reader arriving from the server sees why.
 */
export const EMPTY_DERIVED_FORMULA_MESSAGE = "A derived point requires a formula";
export const EMPTY_KPI_EXPRESSION_MESSAGE = "A KPI requires an expression";

/**
 * Validates what is in the field.
 *
 * **Empty text is an error on both surfaces, including an `"unvalidated"`
 * KPI.** The server rejects it either way — `templatePointBodySchema` refuses a
 * derived point with no `formula`, and `templateKpiSchema` declares
 * `expression: z.string().min(1)` — so staying silent would let the author
 * press Save and learn the rule from a 400, which is the single failure this
 * whole client-side layer exists to prevent.
 *
 * This does not weaken ADR 0038 decision 9. Decision 9 protects a stored
 * expression the author did not touch, and `min(1)` means no stored expression
 * is ever empty. An empty field can only be one the author just cleared.
 *
 * The parser's own message for this case is "the formula is empty at character
 * 0", which describes the text rather than the requirement. These two say what
 * to do instead.
 */
export function validateEditorFormula(rules: FormulaEditorRules, text: string): FormulaValidation {
  if (text.trim().length === 0) {
    const message =
      rules.mode === "derived" ? EMPTY_DERIVED_FORMULA_MESSAGE : EMPTY_KPI_EXPRESSION_MESSAGE;
    return { state: "error", diagnostics: [{ message, from: 0, to: text.length }] };
  }
  if (rules.mode === "derived") {
    return validateDerivedFormula(text, rules.points, rules.selfPointKey, rules.dialect);
  }
  return validateKpiExpression(
    { expression: text, pointKeys: rules.kpiPointKeys, dialect: rules.dialect },
    rules.declaredPointKeys,
  );
}

/**
 * The keys `{` completion offers.
 *
 * In derived mode this is **exactly what the server accepts**, minus the point
 * being edited, so completion prevents the error rather than reporting it —
 * which is what ADR 0038 decision 7 gives as its reason for taking
 * `@codemirror/autocomplete` at all.
 *
 * Under `bms-calc-v1` that is **measured siblings only**. Offering a derived
 * sibling there would be worse than offering nothing: the author would pick it,
 * and the field would immediately underline the choice the editor had just
 * suggested.
 *
 * Under `bms-calc-v2` it is **every sibling**, because ADR 0055 decision 7
 * repeals that ban — a cross-asset formula reads other assets' derived points
 * by design. The same filter that helps under `v1` would hide keys the server
 * now accepts.
 *
 * Self is excluded under both. Decision 7 repealed the sibling ban, not the
 * self-reference one: a formula that reads its own point is a cycle, and Task
 * 12 refuses it at save.
 */
export function completionKeys(rules: FormulaEditorRules): string[] {
  if (rules.mode === "derived") {
    return rules.points
      .filter(
        (point) =>
          point.pointKey !== rules.selfPointKey &&
          (rules.dialect !== CALC_DIALECT || point.kind === "measured"),
      )
      .map((point) => point.pointKey);
  }
  return [...rules.declaredPointKeys];
}

/**
 * Whether the parser checks apply at all.
 *
 * False only for a KPI still at `"unvalidated"` (ADR 0038 decision 9). That
 * field stays free text — no highlighting, no live preview — until the author
 * uses **Validate this expression**.
 *
 * `F2.9`: resolved against `CALC_DIALECTS` rather than compared to the `v1`
 * literal, because the KPI dialect widened (ADR 0055 decision 2, the owner's Q3
 * ruling) and a restated vocabulary drifts from the one it restates.
 *
 * **Task 15 closed both halves.** `validateKpiExpression` now checks a `v2`
 * expression under `v2` instead of returning `"unvalidated"`, so a `true` here
 * and a real diagnostic agree; and {@link decorationDialect} gives the editor
 * the dialect to lex with, so a `v2` expression is highlighted rather than
 * silently rendering unstyled.
 */
export function isCheckedDialect(rules: FormulaEditorRules): boolean {
  return rules.mode === "derived" || CALC_DIALECTS.some((known) => known === rules.dialect);
}

/**
 * The dialect `calcDecorations` should lex with for this surface (`F2.9` Task
 * 15, ADR 0055).
 *
 * A derived formula carries a real `CalcDialect` and uses it. A KPI's dialect
 * also carries `"unvalidated"`, which is not a grammar at all — that row is
 * free text the server has never parsed, so it lexes as `v1`, matching what
 * **Validate this expression** will attempt first. `isCheckedDialect` already
 * suppresses highlighting entirely for that case; this is the answer for the
 * one it does not suppress.
 *
 * Separate from `validateEditorFormula`'s dialect on purpose, even though they
 * agree today: that one decides what is *refused*, this one decides only what
 * is *coloured*, and a highlighting choice must never be able to change a
 * validation result.
 */
export function decorationDialect(rules: FormulaEditorRules): CalcDialect {
  if (rules.mode === "derived") {
    return rules.dialect;
  }
  return CALC_DIALECTS.find((known) => known === rules.dialect) ?? CALC_DIALECT;
}

/**
 * One `@` completion entry. Typed here by hand rather than as
 * `@codemirror/autocomplete`'s `Completion`: this module must not import
 * CodeMirror (`tests/adr-0038-formula-editor.test.ts`), and the component maps
 * these onto the library's shape itself.
 */
export type ScopeCompletion = {
  /** What the popup shows and matches the typed `@…` prefix against. */
  label: string;
  /** What lands in the document when the entry is taken. */
  apply: string;
  /** One line, shown beside the entry: what the scope ranges over. */
  info: string;
};

type CalcScopeKind = (typeof CALC_SCOPE_KINDS)[number];

/**
 * The per-kind half of {@link scopeCompletions}, keyed by the constant's own
 * member type so that a fourth scope kind fails to compile here rather than
 * silently going unoffered. The list itself is built by mapping
 * `CALC_SCOPE_KINDS`, so the order is the grammar's and nothing is restated.
 *
 * `takesCode` is the one shape difference the grammar has: `@site` is complete
 * as written, while `@domain(…)` and `@group(…)` take a quoted code
 * (`parser.ts`, `CalcScope`).
 */
const SCOPE_SHAPES: Record<CalcScopeKind, { takesCode: boolean; info: string }> = {
  site: { takesCode: false, info: "every asset at this asset's site" },
  domain: { takesCode: true, info: "every asset at this site, narrowed to one plant-domain code" },
  group: { takesCode: true, info: "every asset at this site, narrowed to one asset-group code" },
};

/**
 * The scopes `@` completion offers (`F2.22` T5, ADR 0055 decision 1).
 *
 * Empty unless the surface's dialect is `bms-calc-v2`. That is a comparison to
 * one literal on purpose, where `isCheckedDialect` resolves against
 * `CALC_DIALECTS`: the `@` scopes are `v2` **grammar** — `tokenizer.ts` admits
 * a scope token under `v2` only — not a vocabulary a third dialect would
 * inherit. Offering `@site` on a `v1` field would insert text the linter
 * underlines at once, the same failure `completionKeys`'s `v1` sibling filter
 * exists to prevent.
 *
 * Gated on {@link decorationDialect} rather than on `rules.mode`: a `v2` KPI
 * (the owner's Q3 ruling) writes the same grammar as a `v2` derived point, and
 * a KPI at `"unvalidated"` resolves to `v1` there and gets nothing. Completion
 * is an *offer*, like colouring, so the dialect that decides what is coloured
 * is the right one to decide what is offered; neither can change a validation
 * result.
 *
 * **Why `label` and `apply` differ.** The label is what the popup lists and
 * what CodeMirror scores the typed `@do…` prefix against, so it shows the
 * shape the author will recognise — `@site`, `@domain(`, `@group(` — and no
 * more. `apply` is what lands in the field, and for the two scopes that take a
 * code it carries the opening quote as well (`@domain('`), so the caret lands
 * inside the string literal and the author types the code and nothing else.
 * `@site` takes no code, so its two strings are the same.
 */
export function scopeCompletions(rules: FormulaEditorRules): ScopeCompletion[] {
  if (decorationDialect(rules) !== CALC_DIALECT_V2) {
    return [];
  }
  return CALC_SCOPE_KINDS.map((kind) => {
    const shape = SCOPE_SHAPES[kind];
    return {
      label: shape.takesCode ? `@${kind}(` : `@${kind}`,
      apply: shape.takesCode ? `@${kind}('` : `@${kind}`,
      info: shape.info,
    };
  });
}

/**
 * The two reference forms `bms-calc-v2` carries, and what each answers (ADR
 * 0055 decision 6, from the Q1 ruling: "each form answers one of them").
 *
 * This is the teaching the tabs render under a `v2` row (T6, T7, and T12 once
 * PR 2 of this row lands): an author who knows which *question* they are
 * asking can pick the form without
 * reading the grammar. An **aggregate** ranges over a set the database resolves
 * at evaluation time, so a new asset joins the sum by joining the site — a
 * total or a ratio. A **qualified reference** names individual assets, so it
 * can say what entered minus what left — a balance, which an aggregate cannot
 * express without a one-member group per meter.
 *
 * Each `example` is grammar, not prose: `runReferenceFormsTests` parses it
 * under `v2`, so the tabs can never teach a formula the parser refuses.
 */
export const V2_REFERENCE_FORMS = [
  { form: "aggregate", answers: "a total or ratio over a set", example: "sum({kw} @site)" },
  {
    form: "qualified",
    answers: "a balance between named assets",
    example: "{TX_01.kwh} - {TX_02.kwh}",
  },
] as const;

/** One entry of {@link V2_REFERENCE_FORMS}, for a tab that renders them. */
export type V2ReferenceForm = (typeof V2_REFERENCE_FORMS)[number];

/** A diagnostic range that CodeMirror will actually render. */
export type EditorDiagnosticRange = { from: number; to: number; message: string };

/**
 * Clamps diagnostics into the document and widens the invisible ones.
 *
 * Two separate jobs, both arithmetic, both the kind of thing Unit 4's mutation
 * run showed breaks four assertions at once when it drifts:
 *
 * - A range past the end of the document makes CodeMirror throw. Validation
 *   positions come from the parser, which reports against the string it was
 *   given; those agree today, and a clamp is what keeps a future disagreement
 *   from taking the editor down.
 * - A zero-width range renders **nothing**. An `eof` position produces one, and
 *   so does an empty field. It is widened backwards by one character where
 *   there is one to take, so the author sees a mark rather than a silence.
 */
export function editorDiagnosticRanges(
  diagnostics: readonly FormulaDiagnostic[],
  docLength: number,
): EditorDiagnosticRange[] {
  return diagnostics.map((diagnostic) => {
    const from = Math.min(Math.max(diagnostic.from, 0), docLength);
    const to = Math.min(Math.max(diagnostic.to, from), docLength);
    return { from: to === from && from > 0 ? from - 1 : from, to, message: diagnostic.message };
  });
}

/**
 * Replaces every newline with a single space.
 *
 * Both surfaces hold **one** expression. `templatePointBodySchema` caps them at
 * 1000 characters and the tokenizer treats `\n` as ordinary whitespace, so a
 * pasted newline would parse and save — it would just make the field grow a
 * line for no reason the author asked for.
 *
 * One character in, one character out, so a caller can apply this inside a
 * transaction without recomputing the selection. `\r\n` becomes two spaces
 * rather than one, which is the price of that property and is invisible to the
 * parser.
 */
export function flattenNewlines(text: string): string {
  return text.replace(/[\r\n]/g, " ");
}
