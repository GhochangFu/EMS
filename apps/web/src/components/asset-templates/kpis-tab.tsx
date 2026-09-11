/**
 * The KPIs tab (`F2.5`, ADR 0038 decision 9 — Unit 9d).
 *
 * Wiring only. The rules are `src/lib/template-kpi-form.ts`; the expression
 * field is Unit 5's `FormulaEditorLazy` in `"kpi"` mode; the write goes through
 * Unit 6's `mergeTemplateContent`.
 *
 * ## Decision 9, as the tab renders it
 *
 * An `"unvalidated"` expression is editable free text with **no** error
 * underneath it. `F2.3` shipped that column before the parser existed, and
 * templates on `main` hold expressions that never met it — flagging them would
 * turn every pre-existing KPI into a blocker on a tab the author opened to
 * change a name.
 *
 * **Validate this expression** is the only path out of `"unvalidated"`. It
 * checks the expression under the grammar the row's **Grammar** select names —
 * `bms-calc-v1` unless the author chose otherwise (`F2.22`; the select is a
 * target on an unvalidated row, not a stored value). On success the dialect
 * flips, the derived `pointKeys` are written, and the field gains highlighting,
 * the preview and the two-way check. On failure the error renders and nothing
 * is written — the row is replaced only when the validation is ok.
 *
 * ## A checked row's Grammar moves it between dialects, atomically
 *
 * On a checked row the same select is the one control that changes the stored
 * dialect (`F2.22` design decision 2), and it does so through `setKpiDialect`:
 * the row moves only when its expression validates under the target, otherwise
 * the diagnostic renders and the select keeps showing the stored dialect. A
 * `bms-calc-v2` row's `pointKeys` are the derived **local** keys, so a KPI whose
 * every reference is cross-asset reads "nothing" here and is still saveable.
 *
 * ## This is the first tab that writes `content`
 *
 * The detail page's blocked-keys banner explains that a pre-ADR-0019 row cannot
 * be written back. It explains; it does not prevent. Save is disabled here,
 * because this is the tab whose write would be refused.
 *
 * ## No trigger controls
 *
 * A KPI is a read-time display value. It has no write path and no staleness
 * policy, so ADR 0037's `calcTrigger` and friends do not apply — that split is
 * ADR 0038 decision 4's, and the Calculations tab owns those fields. No KPI is
 * evaluated anywhere yet — `F2.33`. Nothing on this tab may read as a computed
 * value.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto, CalcDialect, TemplateKpi } from "@bms/shared";
import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { V2_REFERENCE_FORMS, validateEditorFormula } from "../../lib/formula-editor-rules";
import { dialectOptions } from "../../lib/template-calc-config";
import { checkedDialect } from "../../lib/template-formula-validation";
import { formulaFieldsAreReadOnly } from "../../lib/template-lifecycle";
import {
  mergeTemplateContent,
  unwritableContentKeys,
} from "../../lib/template-content-merge";
import {
  MAX_KPI_ENTRIES,
  blankKpiRow,
  buildKpiPayload,
  effectivePointKeys,
  kpiFormErrors,
  kpiRowsFrom,
  kpisHaveChanged,
  setKpiDialect,
  type TemplateKpiRow,
} from "../../lib/template-kpi-form";
import { FormulaEditorLazy } from "./formula-editor-lazy";
import { FormulaPreview } from "./formula-preview";
import { Field } from "./field";

type KpisTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

/** The stored section, read from the loose `content` record. */
function storedKpis(template: AdminAssetTemplateDto): TemplateKpi[] | undefined {
  const section = template.content.kpis;
  return Array.isArray(section) ? (section as TemplateKpi[]) : undefined;
}

export function KpisTab({ template, editable, onSaved, onDirtyChange }: KpisTabProps) {
  const [rows, setRows] = useState<TemplateKpiRow[]>(() => kpiRowsFrom(storedKpis(template)));
  const [error, setError] = useState<string | null>(null);
  // Keyed by row index. A failed validation — Validate on an `"unvalidated"`
  // row, or a refused Grammar change on a checked one — is a message about one
  // field, not a reason to block the form: the row is exactly as it was, and
  // still valid.
  const [validationErrors, setValidationErrors] = useState<Record<number, string>>({});
  // Keyed by row index, like `validationErrors`. The grammar an `"unvalidated"`
  // row will be checked under when Validate is pressed — UI state, never saved,
  // because the row has no dialect to store until it validates (ADR 0038
  // decision 9). Absent means `bms-calc-v1`, decision 9's path unchanged.
  const [validateTargets, setValidateTargets] = useState<Record<number, CalcDialect>>({});

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx`.
  useEffect(() => {
    setRows(kpiRowsFrom(storedKpis(template)));
    setError(null);
    setValidationErrors({});
    setValidateTargets({});
  }, [template.id, template.status]);

  const declaredPointKeys = template.points.map((point) => point.pointKey);
  const problems = kpiFormErrors(rows, declaredPointKeys);
  const blockedKeys = unwritableContentKeys(template.content);
  const changed = kpisHaveChanged(rows, storedKpis(template));

  // The same comparison Save already uses, reported up so the page can guard a
  // tab switch. The cleanup reports clean on unmount, so switching away cannot
  // leave the page holding this tab's `true`.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);
  const blocked = problems.length > 0 || blockedKeys.length > 0;

  const saveM = useMutation({
    mutationFn: () =>
      updateAdminAssetTemplate(template.id, {
        // The whole content object, not a partial — every other section is
        // carried byte for byte, because a `PATCH` that sends `content`
        // replaces it.
        content: mergeTemplateContent(template.content, {
          section: "kpis",
          value: buildKpiPayload(rows),
        }),
      }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function update(index: number, patch: Partial<TemplateKpiRow>) {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  /**
   * Both dialect moves — Validate on an `"unvalidated"` row, and the Grammar
   * select on a checked one — are one action: check the expression under
   * `target` and write the row only when it passes. For an `"unvalidated"` row
   * with the default target this is exactly what Validate did before `F2.22`
   * (`validateKpiRow` resolves `"unvalidated"` to `bms-calc-v1` itself).
   */
  function applyDialect(index: number, target: CalcDialect) {
    const result = setKpiDialect(rows[index], target, declaredPointKeys);
    if (result.validation.state === "ok") {
      // Only on success. Writing `result.row` either way would still be safe —
      // `setKpiDialect` returns its input row on failure (`F2.22` correction
      // 6) — but gating here keeps decision 9 visible at the call site rather
      // than resting on a property of a function one module away.
      update(index, { dialect: result.row.dialect, pointKeys: result.row.pointKeys });
      setValidationErrors((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      return;
    }
    setValidationErrors((current) => ({
      ...current,
      [index]:
        result.validation.state === "error"
          ? result.validation.diagnostics[0].message
          : "This expression could not be validated.",
    }));
  }

  const sectionProblems = problems.filter((problem) => problem.row === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Saving KPIs is blocked: this template holds content that cannot be written back. The
          banner above lists the keys. Editing here is safe — nothing is sent until they are
          removed.
        </p>
      ) : null}

      {sectionProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {problem.message}
        </p>
      ))}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
          This template declares no KPIs yet.
        </p>
      ) : null}

      {rows.map((kpi, index) => {
        const rowProblems = problems.filter((problem) => problem.row === index);
        const problemFor = (field: string) =>
          rowProblems.find((problem) => problem.field === field)?.message;
        const keys = effectivePointKeys(kpi);
        // Through the vocabulary, never a comparison to the `v1` literal: a
        // stored `bms-calc-v2` KPI was read as unvalidated by exactly that
        // comparison (`F2.22` finding 2) — "Not checked", a manual points list
        // whose value never reached the payload, and a Validate button — while
        // its editor already lexed it as checked. `null` is `"unvalidated"`;
        // a `CalcDialect` is what the preview below is rendered under.
        const checked = checkedDialect(kpi.dialect);
        const validated = checked !== null;
        // What the Grammar select reads: the stored dialect on a checked row,
        // the Validate target on an unvalidated one.
        const grammar = checked ?? validateTargets[index] ?? CALC_DIALECT;
        const live = validateEditorFormula(
          {
            mode: "kpi",
            declaredPointKeys,
            kpiPointKeys: keys,
            dialect: kpi.dialect,
          },
          kpi.expression,
        );

        return (
          <section key={index} className="rounded border border-gray-200 p-3">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Code" error={problemFor("code")}>
                <input
                  type="text"
                  value={kpi.code}
                  disabled={!editable}
                  onChange={(event) => update(index, { code: event.target.value })}
                  className={fieldClass(!editable, problemFor("code"))}
                />
              </Field>
              <Field label="Name" error={problemFor("name")}>
                <input
                  type="text"
                  value={kpi.name}
                  disabled={!editable}
                  onChange={(event) => update(index, { name: event.target.value })}
                  className={fieldClass(!editable, problemFor("name"))}
                />
              </Field>
              <Field label="Unit" error={problemFor("unit")}>
                <input
                  type="text"
                  value={kpi.unit}
                  disabled={!editable}
                  placeholder="none"
                  onChange={(event) => update(index, { unit: event.target.value })}
                  className={fieldClass(!editable, problemFor("unit"))}
                />
              </Field>
              <Field label="Direction">
                {/* Three options, not a checkbox. "Not set" is a real state —
                    `higherIsBetter` is `.optional()`, and an unset direction is
                    not the same as "lower is better". */}
                <select
                  value={kpi.higherIsBetter === null ? "" : String(kpi.higherIsBetter)}
                  disabled={!editable}
                  onChange={(event) =>
                    update(index, {
                      higherIsBetter:
                        event.target.value === "" ? null : event.target.value === "true",
                    })
                  }
                  className={fieldClass(!editable, undefined)}
                >
                  <option value="">not set</option>
                  <option value="true">higher is better</option>
                  <option value="false">lower is better</option>
                </select>
              </Field>
            </div>

            <label className="mt-3 block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                Grammar
              </span>
              <select
                aria-label={`Grammar for ${kpi.code || "this KPI"}`}
                value={grammar}
                disabled={!editable}
                // On a checked row, through `applyDialect` and never a direct
                // write: the row moves only when its expression validates under
                // the target (design decision 2). On an unvalidated row the
                // choice is only remembered — Validate is what applies it. The
                // options come from `dialectOptions()`, so the cast cannot
                // store a label the engine does not know.
                onChange={(event) => {
                  const target = event.target.value as CalcDialect;
                  if (validated) {
                    applyDialect(index, target);
                    return;
                  }
                  setValidateTargets((current) => ({ ...current, [index]: target }));
                }}
                className={fieldClass(!editable, undefined)}
              >
                {dialectOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {kpi.dialect === CALC_DIALECT_V2 ? (
              // The teaching ADR 0055 decision 6 buys: which reference form
              // answers which question. From `V2_REFERENCE_FORMS`, whose
              // examples the parser is proven to accept — the same list the
              // Calculations tab renders, so the two tabs read as one surface.
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
                Expression
              </span>
              <FormulaEditorLazy
                mode="kpi"
                declaredPointKeys={declaredPointKeys}
                kpiPointKeys={keys}
                dialect={kpi.dialect}
                value={kpi.expression}
                // ADR 0038 decision 3, through the named rule rather than
                // `!editable` — see the same line in `calculations-tab.tsx`.
                readOnly={formulaFieldsAreReadOnly(template.status)}
                ariaLabel={`Expression for ${kpi.code || "this KPI"}`}
                onChange={(next) => update(index, { expression: next })}
              />
            </label>

            {/* Decision 9: no error under an unvalidated expression. */}
            {validated && live.state === "error" ? (
              <p className="mt-1 text-[11px] text-red-700">{live.diagnostics[0].message}</p>
            ) : null}
            {problemFor("expression") ? (
              <p className="mt-1 text-[11px] text-red-700">{problemFor("expression")}</p>
            ) : null}
            {validationErrors[index] ? (
              <p className="mt-1 text-[11px] text-red-700">{validationErrors[index]}</p>
            ) : null}
            {/* Decision 9 again: an unvalidated expression shows no preview —
                it is free text the parser has never met, and the panel would
                either lint it or evaluate it under a grammar it was not stored
                under. `checked` is both the gate and the dialect it runs under.
                Disabled on a frozen version, not absent. */}
            {checked !== null ? (
              <FormulaPreview expression={kpi.expression} dialect={checked} disabled={!editable} />
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-bms-muted">
                {validated
                  ? `Checked · reads ${keys.join(", ") || "nothing"}`
                  : "Not checked — this expression is stored as written."}
              </span>
              {editable && !validated ? (
                <button
                  type="button"
                  onClick={() => applyDialect(index, grammar)}
                  className="rounded border border-gray-200 px-3 py-1 text-[11px] font-semibold text-bms-ink"
                >
                  Validate this expression
                </button>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setRows((current) => current.filter((_, position) => position !== index));
                    // `validationErrors` is keyed by row **position**, so a
                    // removal shifts every later row underneath its own
                    // message: remove KPI 0 and the parse error it raised
                    // reappears under the KPI that was KPI 1, which was never
                    // validated. Cleared rather than reindexed — an error is a
                    // statement about an expression at a moment, and after a
                    // structural edit the honest state is "not validated",
                    // which re-running Validate costs nothing to restore. The
                    // Validate targets are keyed the same way and cleared for
                    // the same reason — a remembered grammar under the wrong
                    // row is a worse surprise than the default.
                    setValidationErrors({});
                    setValidateTargets({});
                  }}
                  className="rounded border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-700"
                >
                  Remove
                </button>
              ) : null}
            </div>

            {/* The manual list, only while unvalidated. Once checked, the keys
                come from the expression and a second control would be a way to
                disagree with it. */}
            {!validated ? (
              <Field label="Points this KPI reads" error={problemFor("pointKeys")}>
                <select
                  multiple
                  size={Math.min(5, Math.max(2, declaredPointKeys.length))}
                  value={kpi.pointKeys}
                  disabled={!editable}
                  onChange={(event) =>
                    update(index, {
                      pointKeys: [...event.target.selectedOptions].map((option) => option.value),
                    })
                  }
                  className={fieldClass(!editable, problemFor("pointKeys"))}
                >
                  {declaredPointKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </Field>
            ) : problemFor("pointKeys") ? (
              <p className="mt-1 text-[11px] text-red-700">{problemFor("pointKeys")}</p>
            ) : null}
          </section>
        );
      })}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={rows.length >= MAX_KPI_ENTRIES}
            onClick={() => setRows((current) => [...current, blankKpiRow()])}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
          >
            Add a KPI
          </button>
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save KPIs"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {blockedKeys.length > 0
              ? "Blocked by unwritable content."
              : problems.length > 0
                ? "Fix the problems above to save."
                : changed
                  ? "Sends this section; every other section is carried unchanged."
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
