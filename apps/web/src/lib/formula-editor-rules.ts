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
import type { TemplateKpi } from "@bms/shared";

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
 * "formula" and formulaDialect: "bms-calc-v1"`
 * (`asset-templates.schema.ts:62`), and its KPI equivalent is a bare Zod
 * `too_small` on `expression`. Neither is something an author can act on:
 * `formulaDialect` is a field this editor sets by itself and no one types.
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
    return validateDerivedFormula(text, rules.points, rules.selfPointKey);
  }
  return validateKpiExpression(
    { expression: text, pointKeys: rules.kpiPointKeys, dialect: rules.dialect },
    rules.declaredPointKeys,
  );
}

/**
 * The keys `{` completion offers.
 *
 * In derived mode this is **measured siblings only**, minus the point being
 * edited. Those are exactly the references the server accepts, so completion
 * prevents the error rather than reporting it — which is what ADR 0038
 * decision 7 gives as its reason for taking `@codemirror/autocomplete` at all.
 *
 * Offering a derived sibling here would be worse than offering nothing: the
 * author would pick it, and the field would immediately underline the choice
 * the editor had just suggested.
 */
export function completionKeys(rules: FormulaEditorRules): string[] {
  if (rules.mode === "derived") {
    return rules.points
      .filter((point) => point.kind === "measured" && point.pointKey !== rules.selfPointKey)
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
 */
export function isCheckedDialect(rules: FormulaEditorRules): boolean {
  return rules.mode === "derived" || rules.dialect === "bms-calc-v1";
}

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
