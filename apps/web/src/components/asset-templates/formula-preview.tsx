/**
 * The live formula preview panel (ADR 0038 decision 5; `F2.22` item 6 —
 * T8 of `docs/plans/f2.22-calc-v2-authoring.md`).
 *
 * One sample input per reference the expression reads, and the result line
 * `lib/calc-preview.ts` computes from them — the **same** `evaluate` the calc
 * engine runs, under the row's dialect. `F2.5` shipped that module and its
 * spec and nothing rendered it: `previewFormula` had no caller outside its
 * spec until this component (plan finding 1). Q1 ruled the panel into `F2.22`.
 *
 * ## One row per cross-asset reference, keyed by `crossRefKey(node)`
 *
 * Under `bms-calc-v2` an aggregate such as `sum({kw} @site)` is **one** input
 * (plan design decision 1): its member set is resolved only by the database,
 * which the preview may not reach, so the author types the aggregate's value.
 * The row's state key is `crossRefKey(node)` from `@bms/shared` — the key
 * `evaluate` itself looks up — computed **once** per row and used for both
 * the write and the read, so the panel and the evaluator cannot disagree on
 * it. `formula-preview.spec.tsx` case 1 reddens if the key is anything else.
 * `@bms/shared` carries no printer for a `CalcCrossRef`, so the row's visible
 * label is built from the node's fields (`crossRefLabel`), in the shape the
 * author wrote: `sum(kw) @site`, `sum(kw) @group('IT_LOAD')`, `TX_01.kwh`.
 *
 * ## Sample text is state; an empty row is omitted, never `0`
 *
 * The inputs hold their raw text — UI state, never saved — and the two
 * `CalcSampleValues` maps are built from it on each render. A blank row is
 * **left out** of the map rather than passed through `Number`, because
 * `Number("")` is `0`, finite, and `toInputMap` would keep it: the panel
 * would then read `= 0` for an aggregate nobody has valued, where the author
 * needs the `missing_input` prompt. Spec case 2 is what reddens if that guard
 * is "simplified" away. Any other text a `type="number"` input can hold is a
 * numeric string, and `toInputMap` drops a non-finite one.
 *
 * ## What renders when
 *
 * `"unparsed"` renders nothing: the linter already underlines the parse error
 * at its own offset, and a panel repeating it would say the same thing twice
 * mid-word. That decision is made **inside** this component so the panel
 * stays mounted and keeps its typed values while the author is mid-edit;
 * a tab that unmounted it on every parse error would discard them. A checked
 * expression with no references renders the result line alone. A refusal
 * renders as a prompt in muted text: most of the panel's life is "not every
 * row is filled in yet", and red would shout at the author for not having
 * typed yet.
 *
 * The tabs render the panel **disabled** on a frozen version rather than not
 * at all — the rule `asset-template-stock-view-page.spec.tsx` states for every
 * field (disabled, not absent). A disabled panel shows the empty-row prompt
 * permanently, which is that rule's cost and not a defect.
 *
 * No CodeMirror import here: `tests/adr-0038-formula-editor.test.ts` keeps
 * `formula-editor.tsx` the only importer.
 */
import { useState } from "react";
import type { CalcCrossRef, CalcDialect } from "@bms/shared";
import { crossRefKey } from "@bms/shared";

import {
  previewCrossRefs,
  previewFormula,
  previewInputKeys,
  type CalcSampleValues,
} from "../../lib/calc-preview";

type FormulaPreviewProps = {
  expression: string;
  dialect: CalcDialect;
  /** Every sample input disabled — a frozen version. The panel still renders. */
  disabled?: boolean;
};

/** The raw text of each sample input, keyed as the evaluator's map is. */
type SampleTexts = Readonly<Record<string, string>>;

/**
 * The evaluator's record from the inputs' text. A blank row is omitted — see
 * the docblock: `Number("")` is `0`, and `0` is a value, not an absence.
 */
function sampleValuesFrom(texts: SampleTexts): CalcSampleValues {
  const values: Record<string, number> = {};
  for (const [key, text] of Object.entries(texts)) {
    if (text.trim() !== "") {
      values[key] = Number(text);
    }
  }
  return values;
}

/**
 * A cross-asset node as the author wrote it, without the braces: the
 * aggregate's function, member key and scope, or the qualified reference's
 * `CODE.key`. Built from the node's fields because `@bms/shared` has no
 * printer for one; `crossRefKey` is the *state* key and is not shown — its
 * `a:`/`q:` prefix is an injectivity device, not a label.
 */
function crossRefLabel(node: CalcCrossRef): string {
  if (node.kind === "qref") {
    return `${node.assetCode}.${node.pointKey}`;
  }
  const scope = node.scope.kind === "site" ? "@site" : `@${node.scope.kind}('${node.scope.code}')`;
  return `${node.fn}(${node.pointKey}) ${scope}`;
}

export function FormulaPreview({ expression, dialect, disabled = false }: FormulaPreviewProps) {
  const [values, setValues] = useState<SampleTexts>({});
  const [crossValues, setCrossValues] = useState<SampleTexts>({});

  const keys = previewInputKeys(expression, dialect);
  const crossRefs = previewCrossRefs(expression, dialect);
  const preview = previewFormula(expression, sampleValuesFrom(values), {
    dialect,
    crossValues: sampleValuesFrom(crossValues),
  });

  if (preview.state === "unparsed") {
    return null;
  }

  return (
    <div className="mt-2 rounded border border-dashed border-gray-200 p-2">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
        Preview
      </span>
      {keys.length > 0 || crossRefs.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-3">
          {crossRefs.map((node) => {
            // Once per row, for both the write below and the read through
            // `crossValues` above — the one site the key is derived at.
            const key = crossRefKey(node);
            const label = crossRefLabel(node);
            return (
              <SampleInput
                key={key}
                label={label}
                value={crossValues[key] ?? ""}
                disabled={disabled}
                onChange={(text) => setCrossValues((current) => ({ ...current, [key]: text }))}
              />
            );
          })}
          {keys.map((key) => (
            <SampleInput
              key={key}
              label={key}
              value={values[key] ?? ""}
              disabled={disabled}
              onChange={(text) => setValues((current) => ({ ...current, [key]: text }))}
            />
          ))}
        </div>
      ) : null}
      {/* `<output>` — the element a computed result belongs in; its implicit
          role is `status`, which is how the spec finds it. One text node, so
          `= 5` and the refusal sentence are each queryable whole. */}
      <output
        aria-label="Preview result"
        className={`mt-1 block text-xs ${
          preview.state === "ok" ? "font-semibold text-bms-ink" : "text-bms-muted"
        }`}
      >
        {preview.state === "ok" ? `= ${preview.value}` : preview.message}
      </output>
    </div>
  );
}

type SampleInputProps = {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
};

function SampleInput({ label, value, disabled, onChange }: SampleInputProps) {
  return (
    <label className="block space-y-0.5">
      <span className="block text-[11px] text-bms-muted">
        <code className="rounded bg-gray-100 px-1">{label}</code>
      </span>
      <input
        type="number"
        // Any real number is a legitimate sample; the default step of 1 would
        // mark `0.5` invalid in a real browser for no reason.
        step="any"
        aria-label={`Sample value for ${label}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`w-28 rounded border border-gray-200 px-2 py-1 text-xs ${
          disabled ? "bg-gray-50 text-bms-muted" : ""
        }`}
      />
    </label>
  );
}
