/**
 * The Calculations tab (`F2.5`, ADR 0038 Unit 9c).
 *
 * Wiring only. The formula field is Unit 5's `FormulaEditorLazy` in `"derived"`
 * mode; the trigger, dialect and coverage rules are
 * `src/lib/template-calc-config.ts`; the within-template cycle mirror is
 * `src/lib/template-calc-cycles.ts`; the payload is Unit 9b's
 * `buildPointsPayload`, because the server replaces the whole point set from
 * whichever tab saves and this one edits six fields of it — the formula, its
 * dialect, the three trigger fields, and since `F2.22` the coverage ratio.
 *
 * **The editor is reached through `formula-editor-lazy.tsx`, never directly.**
 * A value import of `formula-editor.tsx` puts CodeMirror in the entry chunk
 * every page downloads. `tests/adr-0038-formula-editor.test.ts` asserts that
 * statically, and this tab is the first real consumer of the split Unit 5
 * built — until now the lazy chunk existed but nothing loaded it.
 *
 * **Only derived points appear here.** A measured point has no formula, and
 * ADR 0037's trigger fields are refused on one. Making a point derived is the
 * Points tab's control, per decision 4, so this tab says where to go rather
 * than growing a second kind switch.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto, CalcDialect } from "@bms/shared";
import { CALC_DIALECT, CALC_DIALECT_V2, CALC_TRIGGERS } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { V2_REFERENCE_FORMS, validateEditorFormula } from "../../lib/formula-editor-rules";
import { formulaFieldsAreReadOnly } from "../../lib/template-lifecycle";
import {
  CALC_INTERVAL_BOUNDS,
  COVERAGE_RATIO_HINT,
  INPUT_AGE_BOUNDS,
  IMPLIED_MAX_INPUT_AGE_SECONDS,
  V2_TRIGGER_LATENCY_HINT,
  calcConfigErrors,
  calcGridErrors,
  dialectOptions,
  parseOptionalRatio,
  parseOptionalSeconds,
  setCalcTrigger,
  setFormulaDialect,
} from "../../lib/template-calc-config";
import { templateCycleProblems } from "../../lib/template-calc-cycles";
import {
  brokenFormulaRefs,
  buildPointsPayload,
  pointRowsFrom,
  pointsHaveChanged,
  type TemplatePointRow,
} from "../../lib/template-points-grid";
import { FormulaEditorLazy } from "./formula-editor-lazy";

type CalculationsTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

export function CalculationsTab({
  template,
  editable,
  onSaved,
  onDirtyChange,
}: CalculationsTabProps) {
  const [rows, setRows] = useState<TemplatePointRow[]>(() => pointRowsFrom(template));
  const [error, setError] = useState<string | null>(null);

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx`.
  useEffect(() => {
    setRows(pointRowsFrom(template));
    setError(null);
  }, [template.id, template.status]);

  const saveM = useMutation({
    mutationFn: () => updateAdminAssetTemplate(template.id, { points: buildPointsPayload(rows) }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  // Every point, with its kind — `validateDerivedFormula` needs the siblings'
  // kinds to enforce ADR 0036 decision 7, not just their keys.
  const siblings = rows.map((row) => ({ pointKey: row.pointKey, kind: row.kind }));
  const derivedIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.kind === "derived");

  const formulaProblems = derivedIndexes.filter(
    (entry) =>
      validateEditorFormula(
        {
          mode: "derived",
          points: siblings,
          selfPointKey: entry.row.pointKey,
          dialect: entry.row.formulaDialect ?? CALC_DIALECT,
        },
        entry.row.formula ?? "",
      ).state === "error",
  );
  const configProblems = calcGridErrors(rows);
  const refProblems = brokenFormulaRefs(rows);
  // `F2.22` item 7 — the within-template cycle mirror, wording for a save the
  // server refuses through `templateCycles`. Blocking here, like the other
  // three, because the server's refusal is certain and the author would
  // otherwise learn of it only from the 400.
  const cycleProblems = templateCycleProblems(rows);
  const blocked =
    formulaProblems.length > 0 ||
    configProblems.length > 0 ||
    refProblems.length > 0 ||
    cycleProblems.length > 0;
  const changed = pointsHaveChanged(rows, template);

  // The same comparison Save already uses, reported up so the page can guard a
  // tab switch. The cleanup reports clean on unmount, so switching away cannot
  // leave the page holding this tab's `true`.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  function update(index: number, patch: Partial<TemplatePointRow>) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  if (derivedIndexes.length === 0) {
    return (
      <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
        This template has no derived points. Add a point on the Points tab and set its kind to
        derived, then set its formula here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {derivedIndexes.map(({ row, index }) => {
        // The dialect the formula is stored under, read once per row so the
        // Grammar select, the editor and the linter cannot disagree on it.
        // `null` on the wire is `v1` — the label a row had before ADR 0055
        // gave it a choice.
        const dialect = row.formulaDialect ?? CALC_DIALECT;
        const isV2 = dialect === CALC_DIALECT_V2;
        const validation = validateEditorFormula(
          {
            mode: "derived",
            points: siblings,
            selfPointKey: row.pointKey,
            dialect,
          },
          row.formula ?? "",
        );
        // `problemFor` renders the *first* problem per field. A broken
        // reference and a cycle both land on `formula`, and the reference
        // comes first: a key that is no longer in the template is the
        // simpler thing to fix, and fixing it may dissolve the cycle.
        const problems = [
          ...calcConfigErrors(row, index),
          ...refProblems.filter((problem) => problem.row === index),
          ...cycleProblems.filter((problem) => problem.row === index),
        ];
        const problemFor = (field: string) =>
          problems.find((problem) => problem.field === field)?.message;

        return (
          <section key={row.pointKey || index} className="rounded border border-gray-200 p-3">
            <header className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold text-bms-ink">
                {row.pointKey || "(no point key)"}
              </span>
              {row.label ? <span className="text-[11px] text-bms-muted">{row.label}</span> : null}
              {row.unit ? <span className="text-[11px] text-bms-muted">· {row.unit}</span> : null}
            </header>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                Grammar
              </span>
              <select
                aria-label={`Grammar for ${row.pointKey}`}
                value={dialect}
                disabled={!editable}
                // Through `setFormulaDialect`, never a direct write: to `v2` it
                // flips a streaming trigger to `scheduled`, the only trigger
                // the server accepts under `v2`; to `v1` it clears the ratio
                // the server refuses off a `v2` point (design decision 3). A
                // value outside `CALC_DIALECTS` returns the row unchanged, so
                // the cast cannot store a label the engine does not know.
                onChange={(event) =>
                  setRows((current) =>
                    current.map((entry, position) =>
                      position === index
                        ? setFormulaDialect(entry, event.target.value as CalcDialect)
                        : entry,
                    ),
                  )
                }
                className={fieldClass(!editable, undefined)}
              >
                {dialectOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isV2 ? (
              // The teaching ADR 0055 decision 6 buys: which reference form
              // answers which question. From `V2_REFERENCE_FORMS`, whose
              // examples the parser is proven to accept.
              <ul className="mt-1 space-y-0.5 text-[11px] text-bms-muted">
                {V2_REFERENCE_FORMS.map((form) => (
                  <li key={form.form}>
                    <span className="font-semibold">{form.form}</span> — {form.answers}:{" "}
                    <code className="rounded bg-gray-100 px-1">{form.example}</code>
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="mt-3 block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                Formula
              </span>
              <FormulaEditorLazy
                mode="derived"
                points={siblings}
                selfPointKey={row.pointKey}
                // The formula's own dialect — the Grammar select's value, not
                // this editor's default. Under `bms-calc-v2` the linter must
                // admit a derived sibling and completion must offer one, and
                // the `@` scopes (ADR 0055 decision 7; `F2.22` T5); under `v1`
                // both stay exactly as decision 3 freezes them.
                dialect={dialect}
                value={row.formula ?? ""}
                // ADR 0038 decision 3's one load-bearing line, expressed
                // through the named rule rather than through `!editable`.
                // Both are true today; only this one fails a test if the
                // lifecycle table ever makes a status editable that must not
                // carry an editable formula.
                readOnly={formulaFieldsAreReadOnly(template.status)}
                ariaLabel={`Formula for ${row.pointKey}`}
                onChange={(next) =>
                  update(index, {
                    formula: next,
                    // **The row's own dialect, defaulting to `v1` only when it
                    // has none.** The Grammar select above is the one control
                    // that changes a row's dialect, and only on the author's
                    // action (design decision 2); this line is not a choice —
                    // it is what a formula edit preserves.
                    //
                    // Stamping `CALC_DIALECT` unconditionally silently
                    // downgraded a stored `bms-calc-v2` formula to `v1` on the
                    // first keystroke, and the API then refused its own syntax
                    // at the `@` of the aggregate it had itself stored. A
                    // control that damages a row it did not author is the worst
                    // shape this tab can take. `calculations-tab.spec.tsx`
                    // case 3 holds it.
                    formulaDialect: dialect,
                  })
                }
              />
            </label>
            {validation.state === "error" ? (
              <p className="mt-1 text-[11px] text-red-700">{validation.diagnostics[0].message}</p>
            ) : null}
            {problemFor("formula") ? (
              <p className="mt-1 text-[11px] text-red-700">{problemFor("formula")}</p>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                  Runs
                </span>
                <select
                  aria-label={`Runs for ${row.pointKey}`}
                  value={row.calcTrigger ?? ""}
                  disabled={!editable}
                  // Through `setCalcTrigger`, never a direct write: switching to
                  // streaming must clear the interval, which the server refuses
                  // on a streaming point.
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? // `setCalcTrigger` maps a non-member — the
                            // "Choose…" option's `""` — back to `null` rather
                            // than storing it. The cast is what let `""`
                            // through as a member before.
                            setCalcTrigger(
                              entry,
                              event.target.value as (typeof CALC_TRIGGERS)[number],
                            )
                          : entry,
                      ),
                    )
                  }
                  className={fieldClass(!editable, problemFor("calcTrigger"))}
                >
                  <option value="">Choose…</option>
                  {/* Disabled under `v2`, not hidden (design decision 5): a
                      stored streaming `v2` row keeps its value visible while
                      `calcConfigErrors`' server sentence names the problem.
                      Hiding it would blank the select the instant a row flips. */}
                  <option value="streaming" disabled={isV2}>
                    on every reading
                  </option>
                  <option value="scheduled">on a schedule</option>
                </select>
                {problemFor("calcTrigger") ? (
                  <span className="block text-[11px] text-red-700">{problemFor("calcTrigger")}</span>
                ) : null}
                {isV2 ? (
                  <span className="block text-[11px] text-bms-muted">{V2_TRIGGER_LATENCY_HINT}</span>
                ) : null}
              </label>

              {/* Only under `scheduled`. Rendering it disabled under streaming
                  would show a control the schema forbids a value in. */}
              {row.calcTrigger === "scheduled" ? (
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                    Every (seconds)
                  </span>
                  <input
                    type="number"
                    min={CALC_INTERVAL_BOUNDS.min}
                    max={CALC_INTERVAL_BOUNDS.max}
                    value={row.calcIntervalSeconds ?? ""}
                    disabled={!editable}
                    onChange={(event) =>
                      update(index, {
                        calcIntervalSeconds: parseOptionalSeconds(event.target.value),
                      })
                    }
                    className={fieldClass(!editable, problemFor("calcIntervalSeconds"))}
                  />
                  {problemFor("calcIntervalSeconds") ? (
                    <span className="block text-[11px] text-red-700">
                      {problemFor("calcIntervalSeconds")}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                  Ignore inputs older than
                </span>
                <input
                  type="number"
                  min={INPUT_AGE_BOUNDS.min}
                  max={INPUT_AGE_BOUNDS.max}
                  value={row.maxInputAgeSeconds ?? ""}
                  disabled={!editable}
                  // The placeholder, not a pre-filled value: `null` means "the
                  // engine decides", and a typed 300 means "the author chose
                  // 300". They are the same number today and would stop being
                  // the same number the day the default moves.
                  placeholder={`${IMPLIED_MAX_INPUT_AGE_SECONDS} by default`}
                  onChange={(event) =>
                    update(index, { maxInputAgeSeconds: parseOptionalSeconds(event.target.value) })
                  }
                  className={fieldClass(!editable, problemFor("maxInputAgeSeconds"))}
                />
                {problemFor("maxInputAgeSeconds") ? (
                  <span className="block text-[11px] text-red-700">
                    {problemFor("maxInputAgeSeconds")}
                  </span>
                ) : null}
              </label>

              {/* Only under `v2` (ADR 0055 decision 11): the ratio is the
                  coverage of an aggregate's member set, and the server refuses
                  one on any other point. `setFormulaDialect` clears it on the
                  way to `v1`, so the field and its value leave together. */}
              {isV2 ? (
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                    Minimum coverage
                  </span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    aria-label={`Minimum coverage for ${row.pointKey}`}
                    value={row.minCoverageRatio ?? ""}
                    disabled={!editable}
                    // The placeholder says what empty means, because on this
                    // field it is the strict setting, not the lax one.
                    placeholder="fail closed"
                    onChange={(event) =>
                      update(index, { minCoverageRatio: parseOptionalRatio(event.target.value) })
                    }
                    className={fieldClass(!editable, problemFor("minCoverageRatio"))}
                  />
                  {problemFor("minCoverageRatio") ? (
                    <span className="block text-[11px] text-red-700">
                      {problemFor("minCoverageRatio")}
                    </span>
                  ) : null}
                  <span className="block text-[11px] text-bms-muted">{COVERAGE_RATIO_HINT}</span>
                </label>
              ) : null}
            </div>
          </section>
        );
      })}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save calculations"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {blocked
              ? "Fix the problems above to save."
              : changed
                ? `Sends all ${rows.length} points — the server replaces the set.`
                : "No changes yet."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function fieldClass(disabled: boolean, problem: string | undefined): string {
  const tone = problem ? "border-red-300 bg-red-50" : "border-gray-200";
  return `w-full rounded border px-2 py-1.5 text-xs ${tone} ${
    disabled ? "bg-gray-50 text-bms-muted" : ""
  }`;
}
