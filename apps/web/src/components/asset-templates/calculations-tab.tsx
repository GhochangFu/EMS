/**
 * The Calculations tab (`F2.5`, ADR 0038 Unit 9c).
 *
 * Wiring only. The formula field is Unit 5's `FormulaEditorLazy` in `"derived"`
 * mode; the trigger rules are `src/lib/template-calc-config.ts`; the payload is
 * Unit 9b's `buildPointsPayload`, because the server replaces the whole point
 * set from whichever tab saves and this one edits five fields of it.
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
import type { AdminAssetTemplateDto } from "@bms/shared";
import { CALC_DIALECT, CALC_TRIGGERS } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { validateEditorFormula } from "../../lib/formula-editor-rules";
import {
  CALC_INTERVAL_BOUNDS,
  INPUT_AGE_BOUNDS,
  IMPLIED_MAX_INPUT_AGE_SECONDS,
  calcConfigErrors,
  calcGridErrors,
  parseOptionalSeconds,
  setCalcTrigger,
} from "../../lib/template-calc-config";
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
};

export function CalculationsTab({ template, editable, onSaved }: CalculationsTabProps) {
  const [rows, setRows] = useState<TemplatePointRow[]>(() => pointRowsFrom(template));
  const [error, setError] = useState<string | null>(null);

  // Keyed on the row id alone — see `details-tab.tsx` for why a refetch must
  // not replace an unsaved edit.
  useEffect(() => {
    setRows(pointRowsFrom(template));
    setError(null);
  }, [template.id]);

  const saveM = useMutation({
    mutationFn: () => updateAdminAssetTemplate(template.id, { points: buildPointsPayload(rows) }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(cause.message),
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
        { mode: "derived", points: siblings, selfPointKey: entry.row.pointKey },
        entry.row.formula ?? "",
      ).state === "error",
  );
  const configProblems = calcGridErrors(rows);
  const refProblems = brokenFormulaRefs(rows);
  const blocked = formulaProblems.length > 0 || configProblems.length > 0 || refProblems.length > 0;
  const changed = pointsHaveChanged(rows, template);

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
        const validation = validateEditorFormula(
          { mode: "derived", points: siblings, selfPointKey: row.pointKey },
          row.formula ?? "",
        );
        const problems = [
          ...calcConfigErrors(row, index),
          ...refProblems.filter((problem) => problem.row === index),
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
                Formula
              </span>
              <FormulaEditorLazy
                mode="derived"
                points={siblings}
                selfPointKey={row.pointKey}
                value={row.formula ?? ""}
                readOnly={!editable}
                ariaLabel={`Formula for ${row.pointKey}`}
                onChange={(next) =>
                  update(index, {
                    formula: next,
                    // The dialect is this editor's, never typed. A formula with
                    // no dialect is refused, and there is exactly one.
                    formulaDialect: CALC_DIALECT,
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

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                  Runs
                </span>
                <select
                  value={row.calcTrigger ?? ""}
                  disabled={!editable}
                  // Through `setCalcTrigger`, never a direct write: switching to
                  // streaming must clear the interval, which the server refuses
                  // on a streaming point.
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? setCalcTrigger(
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
                  <option value="streaming">on every reading</option>
                  <option value="scheduled">on a schedule</option>
                </select>
                {problemFor("calcTrigger") ? (
                  <span className="block text-[11px] text-red-700">{problemFor("calcTrigger")}</span>
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
