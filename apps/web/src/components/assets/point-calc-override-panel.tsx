/**
 * The per-point calc override panel (`F2.6`, ADR 0039 decisions 6, 7 and 8).
 *
 * Presentation only. Every rule is in `lib/asset-point-calc-override.ts`,
 * because `apps/web`'s Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts` and the coverage gate reaches `src/lib/**` and nothing
 * above it — a `.tsx` is untestable and uncovered in this repository.
 *
 * The shape the panel is built around: **three values per column, not one.**
 * "Every 300s" tells an operator what runs but not whether editing the template
 * would change it, and that is the whole question an override screen exists to
 * answer.
 */
import { CALC_TRIGGERS } from "@bms/shared";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import {
  calcFieldRows,
  canClear,
  canSubmit,
  draftProblems,
  type OverrideDraft,
} from "../../lib/asset-point-calc-override";

type Props = {
  config: AssetPointCalcConfigDto;
  draft: OverrideDraft;
  busy: boolean;
  onDraftChange: (next: OverrideDraft) => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
};

const ORIGIN_LABEL: Record<string, string> = {
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
        </tbody>
      </table>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs sm:col-span-2">
          <span className="text-bms-muted">Formula — leave empty to inherit</span>
          <input
            type="text"
            value={draft.formula}
            disabled={busy}
            onChange={(event) => set({ formula: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 font-mono"
            placeholder={config.template.formula ?? ""}
          />
        </label>
        <label className="text-xs">
          <span className="text-bms-muted">Runs</span>
          <select
            value={draft.calcTrigger}
            disabled={busy}
            onChange={(event) => set({ calcTrigger: event.target.value })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1"
          >
            <option value="">inherit ({config.template.calcTrigger ?? "not set"})</option>
            {CALC_TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {trigger}
              </option>
            ))}
          </select>
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
