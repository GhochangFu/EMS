/**
 * The per-point calc override panel (`F2.6`, ADR 0039 decisions 6, 7 and 8;
 * `F2.22` T12 for the `bms-calc-v2` controls).
 *
 * Presentation only. Every rule is in `lib/asset-point-calc-override.ts`,
 * because the coverage gate reaches `src/lib/**` and nothing above it. The
 * render itself is `point-calc-override-panel.spec.tsx`'s claim (jsdom, ADR
 * 0042) — the first spec to mount this panel.
 *
 * The shape the panel is built around: **three values per column, not one.**
 * "Every 300s" tells an operator what runs but not whether editing the template
 * would change it, and that is the whole question an override screen exists to
 * answer.
 *
 * The `v2` controls mirror the Calculations tab's, from the same sources:
 * Grammar lists `dialectOptions()` after an `inherit (…)` option, the
 * streaming option is disabled — not hidden — under a merged `v2` (design
 * decision 5) with `V2_TRIGGER_LATENCY_HINT` beside it, and the two
 * `V2_REFERENCE_FORMS` are taught under the formula. The coverage ratio is
 * the one thing the tab edits and this panel only shows: ADR 0055 decision 11
 * refuses a per-asset override, so it is a line in the table, not a field.
 */
import { CALC_DIALECT_V2, CALC_TRIGGERS } from "@bms/shared";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import {
  calcFieldRows,
  canClear,
  canSubmit,
  coverageRatioDisplay,
  draftProblems,
  mergedDialect,
  type ColumnOrigin,
  type OverrideDraft,
} from "../../lib/asset-point-calc-override";
import { V2_REFERENCE_FORMS } from "../../lib/formula-editor-rules";
import { V2_TRIGGER_LATENCY_HINT, dialectOptions } from "../../lib/template-calc-config";

type Props = {
  config: AssetPointCalcConfigDto;
  draft: OverrideDraft;
  busy: boolean;
  onDraftChange: (next: OverrideDraft) => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
};

// Keyed on the union, not on `string`: a fourth origin added to `ColumnOrigin`
// must fail the build here rather than render an empty Source cell.
const ORIGIN_LABEL: Record<ColumnOrigin, string> = {
  overridden: "overridden here",
  inherited: "from the template",
  unset: "not set",
};

export function PointCalcOverridePanel({
  config,
  draft,
  busy,
  onDraftChange,
  onSave,
  onClear,
  onCancel,
}: Props) {
  const rows = calcFieldRows(config);
  const problems = draftProblems(draft, config);
  const set = (patch: Partial<OverrideDraft>) => onDraftChange({ ...draft, ...patch });
  // The grammar in force after the save — the draft's when chosen, the
  // template's when inheriting — from the same function `draftProblems` reads,
  // so the controls below and the sentences under them cannot disagree.
  const isV2 = mergedDialect(draft, config) === CALC_DIALECT_V2;

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {config.label ?? config.pointKey}
          {config.unit ? <span className="text-bms-muted"> · {config.unit}</span> : null}
        </h3>
        <span className="font-mono text-xs text-bms-muted">{config.pointKey}</span>
      </div>

      <table className="mt-2 w-full text-left text-xs">
        <thead className="text-bms-muted">
          <tr>
            <th className="py-1 font-medium">Setting</th>
            <th className="py-1 font-medium">Template</th>
            <th className="py-1 font-medium">In effect</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-t border-gray-100">
              <td className="py-1">{row.label}</td>
              <td className="py-1 font-mono">{row.templateValue}</td>
              <td className="py-1 font-mono">{row.effectiveValue}</td>
              <td className="py-1 text-bms-muted">{ORIGIN_LABEL[row.origin]}</td>
            </tr>
          ))}
          {/* `F2.22` item 4 — the template's ratio, read-only (ADR 0055
              decision 11, ruling Q3). A line here and not a `CALC_FIELDS`
              row: it has no override role and no merge, so "Template" and
              "In effect" are the same value by construction, and the Source
              column says why there is no field for it below. */}
          <tr className="border-t border-gray-100">
            <td className="py-1">Minimum coverage</td>
            <td className="py-1 font-mono">{coverageRatioDisplay(config.minCoverageRatio)}</td>
            <td className="py-1 font-mono">{coverageRatioDisplay(config.minCoverageRatio)}</td>
            <td className="py-1 text-bms-muted">from the template — not overridable per asset</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs sm:col-span-2">
          <span className="text-bms-muted">Grammar</span>
          <select
            aria-label={`Grammar for ${config.pointKey}`}
            value={draft.formulaDialect}
            disabled={busy}
            // A direct write, unlike the tab's `setFormulaDialect`: an
            // override clears nothing on a dialect change, because every
            // other column is a separate inherit-or-set choice and the
            // merged rules below say what the pair needs.
            onChange={(event) => set({ formulaDialect: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1"
          >
            <option value="">inherit ({config.template.formulaDialect ?? "not set"})</option>
            {dialectOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="text-bms-muted">Formula — leave empty to inherit</span>
          <input
            type="text"
            aria-label={`Formula for ${config.pointKey}`}
            value={draft.formula}
            disabled={busy}
            onChange={(event) => set({ formula: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 font-mono"
            placeholder={config.template.formula ?? ""}
          />
        </label>
        {isV2 ? (
          // The teaching ADR 0055 decision 6 buys, as the Calculations tab
          // renders it: which reference form answers which question. A
          // sibling of the label, as on the tab — a list inside a `<label>`
          // is flow content in phrasing content, and a click on an example
          // would focus the input.
          <ul className="space-y-0.5 text-[11px] text-bms-muted sm:col-span-2">
            {V2_REFERENCE_FORMS.map((form) => (
              <li key={form.form}>
                <span className="font-semibold">{form.form}</span> — {form.answers}:{" "}
                <code className="rounded bg-gray-100 px-1">{form.example}</code>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="text-xs">
          <span className="text-bms-muted">Runs</span>
          <select
            aria-label={`Runs for ${config.pointKey}`}
            value={draft.calcTrigger}
            disabled={busy}
            onChange={(event) => set({ calcTrigger: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1"
          >
            <option value="">inherit ({config.template.calcTrigger ?? "not set"})</option>
            {/* Disabled under a merged `v2`, not hidden (design decision 5):
                a stored streaming override keeps its value visible while
                `draftProblems`' server sentence names the problem. */}
            {CALC_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger} disabled={isV2 && trigger === "streaming"}>
                {trigger}
              </option>
            ))}
          </select>
          {isV2 ? (
            <span className="mt-1 block text-[11px] text-bms-muted">{V2_TRIGGER_LATENCY_HINT}</span>
          ) : null}
        </label>
        <label className="text-xs">
          <span className="text-bms-muted">Every (seconds)</span>
          <input
            type="number"
            value={draft.calcIntervalSeconds}
            disabled={busy}
            onChange={(event) => set({ calcIntervalSeconds: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1"
            placeholder={
              config.template.calcIntervalSeconds === null
                ? "inherit"
                : String(config.template.calcIntervalSeconds)
            }
          />
        </label>
        <label className="text-xs">
          <span className="text-bms-muted">Inputs valid for (seconds)</span>
          <input
            type="number"
            value={draft.maxInputAgeSeconds}
            disabled={busy}
            onChange={(event) => set({ maxInputAgeSeconds: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1"
            placeholder={
              config.template.maxInputAgeSeconds === null
                ? "inherit"
                : String(config.template.maxInputAgeSeconds)
            }
          />
        </label>
      </div>

      {problems.length > 0 ? (
        // D-1 while the author is still looking at both fields, rather than
        // from a 400 after Save. The API stays the authority; this is the same
        // sentence, earlier.
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-700">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canSubmit(draft, config)}
          onClick={onSave}
          className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Save override
        </button>
        <button
          type="button"
          // Disabled with nothing overridden: the API returns 404, and an error
          // that says nothing went wrong is the worst kind.
          disabled={busy || !canClear(config)}
          onClick={onClear}
          className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
        >
          Clear override
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted disabled:opacity-60"
        >
          Close
        </button>
      </div>
    </div>
  );
}
