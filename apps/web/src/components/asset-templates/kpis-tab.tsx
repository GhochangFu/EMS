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
 * **Validate this expression** is the only path to `bms-calc-v1`. On success
 * the dialect flips, the derived `pointKeys` are written, and the field gains
 * highlighting, the preview and the two-way check. On failure the error renders
 * and nothing is written — the row is replaced only when the validation is ok.
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
 * ADR 0038 decision 4's, and the Calculations tab owns those fields.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto, TemplateKpi } from "@bms/shared";
import { CALC_DIALECT } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { validateEditorFormula } from "../../lib/formula-editor-rules";
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
  validateKpiRow,
  type TemplateKpiRow,
} from "../../lib/template-kpi-form";
import { FormulaEditorLazy } from "./formula-editor-lazy";

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
  // Keyed by row index. A failed validation is a message about one field, not a
  // reason to block the form — the row is still `"unvalidated"` and still valid.
  const [validationErrors, setValidationErrors] = useState<Record<number, string>>({});

  // Keyed on the row id alone — see `details-tab.tsx`.
  useEffect(() => {
    setRows(kpiRowsFrom(storedKpis(template)));
    setError(null);
    setValidationErrors({});
  }, [template.id]);

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
    onError: (cause: Error) => setError(cause.message),
  });

  function update(index: number, patch: Partial<TemplateKpiRow>) {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  function validate(index: number) {
    const result = validateKpiRow(rows[index], declaredPointKeys);
    if (result.validation.state === "ok") {
      // Only on success. Writing `result.row` either way would still be safe —
      // `upgradeKpiToCalcDialect` returns its input on failure — but gating
      // here keeps decision 9 visible at the call site rather than resting on a
      // property of a function two modules away.
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
        const validated = kpi.dialect === CALC_DIALECT;
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
                Expression
              </span>
              <FormulaEditorLazy
                mode="kpi"
                declaredPointKeys={declaredPointKeys}
                kpiPointKeys={keys}
                dialect={kpi.dialect}
                value={kpi.expression}
                readOnly={!editable}
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

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-bms-muted">
                {validated
                  ? `Checked · reads ${keys.join(", ") || "nothing"}`
                  : "Not checked — this expression is stored as written."}
              </span>
              {editable && !validated ? (
                <button
                  type="button"
                  onClick={() => validate(index)}
                  className="rounded border border-gray-200 px-3 py-1 text-[11px] font-semibold text-bms-ink"
                >
                  Validate this expression
                </button>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) => current.filter((_, position) => position !== index))
                  }
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

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
        {label}
      </span>
      {children}
      {error ? <span className="block text-[11px] text-red-700">{error}</span> : null}
    </label>
  );
}
