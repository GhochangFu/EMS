/**
 * The cross-asset teaching both the editor's completion and the Formula help
 * read (`F4.314`, ADR 0038 Amendment 6): the `@` scope shapes and the two
 * `bms-calc-v2` reference forms.
 *
 * A leaf on purpose. These lived in `formula-editor-rules.ts`, and
 * `formula-help.ts` needs them while `formula-editor-rules.ts` needs
 * `formula-help.ts` (`functionCompletions` reads the help list), so keeping
 * them there made the two import each other. Here they import nothing but
 * `@bms/shared`, and `formula-editor-rules.ts` re-exports them so existing
 * imports are unchanged. No CodeMirror (`tests/adr-0038-formula-editor.test.ts`).
 */
import { CALC_SCOPE_KINDS } from "@bms/shared";

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
 * The per-kind half of {@link calcScopeForms}, keyed by the constant's own
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
 * Every `@` scope the grammar admits, with no dialect gate — the gate is the
 * caller's (`scopeCompletions` in `formula-editor-rules.ts`, the cross-asset
 * branch of `formulaHelpEntries`).
 *
 * **Why `label` and `apply` differ.** The label is what the popup lists and
 * what CodeMirror scores the typed `@do…` prefix against, so it shows the
 * shape the author will recognise — `@site`, `@domain(`, `@group(` — and no
 * more. `apply` is what lands in the field, and for the two scopes that take a
 * code it carries the opening quote as well (`@domain('`), so the caret lands
 * inside the string literal and the author types the code and nothing else.
 * `@site` takes no code, so its two strings are the same.
 */
export function calcScopeForms(): ScopeCompletion[] {
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
 * This is the teaching every formula field renders under a `v2` row — since
 * `F4.314` as two entries of the Formula help (`formula-help.ts`), which
 * replaced the lists T6, T7 and T12 rendered: an author who knows which
 * *question* they are asking can pick the form without reading the grammar.
 * An **aggregate** ranges over a set the database resolves at evaluation
 * time, so a new asset joins the sum by joining the site — a total or a
 * ratio. A **qualified reference** names individual assets, so it can say
 * what entered minus what left — a balance, which an aggregate cannot express
 * without a one-member group per meter.
 *
 * Each `example` is grammar, not prose: `runReferenceFormsTests` parses it
 * under `v2`, so the help can never teach a formula the parser refuses.
 */
export const V2_REFERENCE_FORMS = [
  { form: "aggregate", answers: "a total or ratio over a set", example: "sum({kw} @site)" },
  {
    form: "qualified",
    answers: "a balance between named assets",
    example: "{TX_01.kwh} - {TX_02.kwh}",
  },
] as const;

/** One entry of {@link V2_REFERENCE_FORMS}. */
export type V2ReferenceForm = (typeof V2_REFERENCE_FORMS)[number];
