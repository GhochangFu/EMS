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
 * decision 5) with `V2_TRIGGER_LATENCY_HINT` beside it, and the Formula help
 * (`F4.314`, ADR 0038 Amendment 6) is under the formula. The coverage ratio is
 * the one thing the tab edits and this panel only shows: ADR 0055 decision 11
 * refuses a per-asset override, so it is a line in the table, not a field.
 *
 * `F3.85` PR 11b: the parts (`PointCalcHeading`, `PointCalcSettingsTable`,
 * `PointCalcFormulaFields`, `PointCalcScheduleFields`, `PointCalcDraftProblems`)
 * are exported, because the asset-points page's `calcOverride.set` wizard
 * renders them in its Formula and Schedule steps. The panel composes the same
 * parts, so its DOM is unchanged.
 */
import type { ReactNode } from "react";
import { CALC_DIALECT, CALC_TRIGGERS, isCrossAssetDialect, isParameterDialect } from "@bms/shared";
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
import { type FormulaSuggestion, suggestionDraft } from "../../lib/formula-suggestions";
import { V2_TRIGGER_LATENCY_HINT, V3_TRIGGER_LATENCY_HINT, dialectOptions } from "../../lib/template-calc-config";
import { FormulaHelp } from "../asset-templates/formula-help";
import { BackfillDaysSelect } from "./backfill-days-select";
import { FormulaSuggestions } from "./formula-suggestions";

/**
 * `F4.314` PR 2 (ADR 0038 Amendment 6 A3, ruling 7) — what the Suggested
 * formulas under the formula are read for: the asset's organization and
 * domain, its keys for the missing-input mark (`null` in the bulk wizard),
 * and on an override the template point whose version is the asset's own.
 */
export type PointCalcSuggestionScope = {
  organizationCode: string | null;
  domain: string | null;
  assetKeys: readonly string[] | null;
  excludeTemplatePointId?: string | null;
};

type Props = {
  config: AssetPointCalcConfigDto;
  draft: OverrideDraft;
  saving: boolean;
  clearing: boolean;
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

/**
 * The controls' shared props. `F3.85` PR 11b split the panel into these parts
 * so the asset-points page's `calcOverride.set` wizard renders the same
 * controls in its Formula and Schedule steps; the panel composes them as it
 * always did.
 */
type FieldsProps = {
  config: AssetPointCalcConfigDto;
  draft: OverrideDraft;
  busy: boolean;
  /**
   * `taken` is the suggestion **Use this formula** applied (`F4.315` review C1): a standalone
   * surface keeps that suggestion's own input age as chosen. Every other edit passes none.
   */
  onDraftChange: (next: OverrideDraft, taken?: FormulaSuggestion) => void;
  /**
   * `F4.311` PR 6a (ADR 0109 decision 1): a calculated point on an asset with
   * no template has nothing to inherit, so the `inherit (…)` options and the
   * template placeholders are dropped. Absent, the override's DOM is unchanged.
   */
  standalone?: boolean;
  /** `F4.311` PR 6a: the formula control in place of the plain input (the standalone panel's lazy editor). */
  formulaEditor?: ReactNode;
  /** `F4.314` PR 2: offer Suggested formulas for `config.pointKey`; absent, the DOM is unchanged. */
  suggestions?: PointCalcSuggestionScope;
};

/** The point's name and key — the panel's heading. */
export function PointCalcHeading({ config }: { config: AssetPointCalcConfigDto }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">
        {config.label ?? config.pointKey}
        {config.unit ? <span className="text-ink-muted"> · {config.unit}</span> : null}
      </h3>
      <span className="font-mono text-xs text-ink-muted">{config.pointKey}</span>
    </div>
  );
}

/** Template, in effect and source per column, and the read-only coverage line. */
export function PointCalcSettingsTable({ config }: { config: AssetPointCalcConfigDto }) {
  const rows = calcFieldRows(config);
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead className="text-ink-muted">
        <tr>
          <th className="py-1 font-medium">Setting</th>
          <th className="py-1 font-medium">Template</th>
          <th className="py-1 font-medium">In effect</th>
          <th className="py-1 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field} className="border-t border-well-deep">
            <td className="py-1">{row.label}</td>
            <td className="py-1 font-mono">{row.templateValue}</td>
            <td className="py-1 font-mono">{row.effectiveValue}</td>
            <td className="py-1 text-ink-muted">{ORIGIN_LABEL[row.origin]}</td>
          </tr>
        ))}
        {/* `F2.22` item 4 — the template's ratio, read-only (ADR 0055
            decision 11, ruling Q3). A line here and not a `CALC_FIELDS`
            row: it has no override role and no merge, so "Template" and
            "In effect" are the same value by construction, and the Source
            column says why there is no field for it below. */}
        <tr className="border-t border-well-deep">
          <td className="py-1">Minimum coverage</td>
          <td className="py-1 font-mono">{coverageRatioDisplay(config.minCoverageRatio)}</td>
          <td className="py-1 font-mono">{coverageRatioDisplay(config.minCoverageRatio)}</td>
          <td className="py-1 text-ink-muted">from the template — not overridable per asset</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Grammar, Formula and the Formula help — the wizard's Formula step. */
export function PointCalcFormulaFields({
  config,
  draft,
  busy,
  onDraftChange,
  standalone = false,
  formulaEditor,
  suggestions,
}: FieldsProps) {
  const set = (patch: Partial<OverrideDraft>) => onDraftChange({ ...draft, ...patch });
  // The grammar in force after the save — the draft's when chosen, the
  // template's when inheriting — from the same function `draftProblems` reads,
  // so the controls below and the help under them cannot disagree. Unset on
  // both sides, the server's default `v1` is what the help teaches.
  const merged = mergedDialect(draft, config);
  return (
    <>
      <label className="text-xs sm:col-span-2">
        <span className="text-ink-muted">Grammar</span>
        <select
          aria-label={`Grammar for ${config.pointKey}`}
          value={draft.formulaDialect}
          disabled={busy}
          // A direct write, unlike the tab's `setFormulaDialect`: an
          // override clears nothing on a dialect change, because every
          // other column is a separate inherit-or-set choice and the
          // merged rules below say what the pair needs.
          onChange={(event) => set({ formulaDialect: event.target.value })}
          className="mt-1 w-full surface-field px-2 py-1"
        >
          {standalone ? null : (
            <option value="">inherit ({config.template.formulaDialect ?? "not set"})</option>
          )}
          {dialectOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs sm:col-span-2">
        <span className="text-ink-muted">{standalone ? "Formula" : "Formula — leave empty to inherit"}</span>
        {formulaEditor ?? (
          <input
            type="text"
            aria-label={`Formula for ${config.pointKey}`}
            value={draft.formula}
            disabled={busy}
            onChange={(event) => set({ formula: event.target.value })}
            className="mt-1 w-full surface-field px-2 py-1 font-mono"
            placeholder={standalone ? undefined : (config.template.formula ?? "")}
          />
        )}
      </label>
      {/* `F4.314` (ADR 0038 Amendment 6 A1): the Formula help for the grammar
          in force, in place of the old `v2`/`v3` list. A sibling of the
          label, as before — a button inside a `<label>` would focus the
          input. An entry appends through the same `set` the input uses, so
          the plain input and the Add panel's editor behave alike. */}
      <FormulaHelp
        dialect={merged ?? CALC_DIALECT}
        disabled={busy}
        onInsert={(text) => set({ formula: draft.formula + text })}
      />
      {/* `F4.314` PR 2 (A3, ruling 6): taking a suggestion writes its formula,
          dialect and timing through the same `set` — the draft's own merge,
          so the merged-dialect rules below (`v2` disables streaming,
          `draftProblems`) judge the result as they judge a typed one. */}
      {suggestions ? (
        <FormulaSuggestions
          pointKey={config.pointKey}
          {...suggestions}
          disabled={busy}
          onTake={(suggestion) => onDraftChange({ ...draft, ...suggestionDraft(suggestion, standalone) }, suggestion)}
        />
      ) : null}
    </>
  );
}

/**
 * `F4.311` PR 5 (owner ruling 1) — the `calcOverride.set` wizard's Backfill
 * step: optional days of history to compute once the override is saved. The
 * select is PR 6a's shared `BackfillDaysSelect`, named after the point.
 */
export function PointCalcBackfillField({ config, draft, busy, onDraftChange }: FieldsProps) {
  return (
    <BackfillDaysSelect
      label={`Backfill for ${config.pointKey}`}
      value={draft.backfillDays ?? ""}
      disabled={busy}
      onChange={(days) => onDraftChange({ ...draft, backfillDays: days })}
    />
  );
}

/** Runs, Every and Inputs valid for — the wizard's Schedule step. */
export function PointCalcScheduleFields({ config, draft, busy, onDraftChange, standalone = false }: FieldsProps) {
  const set = (patch: Partial<OverrideDraft>) => onDraftChange({ ...draft, ...patch });
  const merged = mergedDialect(draft, config);
  const isV2 = merged !== null && isCrossAssetDialect(merged);
  const isV3 = merged !== null && isParameterDialect(merged);
  return (
    <>
      <label className="text-xs">
        <span className="text-ink-muted">Runs</span>
        <select
          aria-label={`Runs for ${config.pointKey}`}
          value={draft.calcTrigger}
          disabled={busy}
          onChange={(event) => set({ calcTrigger: event.target.value })}
          className="mt-1 w-full surface-field px-2 py-1"
        >
          {standalone ? null : <option value="">inherit ({config.template.calcTrigger ?? "not set"})</option>}
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
          <span className="mt-1 block text-[11px] text-ink-muted">
            {isV3 ? V3_TRIGGER_LATENCY_HINT : V2_TRIGGER_LATENCY_HINT}
          </span>
        ) : null}
      </label>
      <label className="text-xs">
        <span className="text-ink-muted">Every (seconds)</span>
        <input
          type="number"
          value={draft.calcIntervalSeconds}
          disabled={busy}
          onChange={(event) => set({ calcIntervalSeconds: event.target.value })}
          className="mt-1 w-full surface-field px-2 py-1"
          placeholder={
            standalone
              ? undefined
              : config.template.calcIntervalSeconds === null
                ? "inherit"
                : String(config.template.calcIntervalSeconds)
          }
        />
      </label>
      <label className="text-xs">
        <span className="text-ink-muted">Inputs valid for (seconds)</span>
        <input
          type="number"
          value={draft.maxInputAgeSeconds}
          disabled={busy}
          onChange={(event) => set({ maxInputAgeSeconds: event.target.value })}
          className="mt-1 w-full surface-field px-2 py-1"
          placeholder={
            standalone
              ? undefined
              : config.template.maxInputAgeSeconds === null
                ? "inherit"
                : String(config.template.maxInputAgeSeconds)
          }
        />
      </label>
    </>
  );
}

/**
 * D-1 while the author is still looking at both fields, rather than from a
 * 400 after Save. The API stays the authority; this is the same sentence,
 * earlier.
 */
export function PointCalcDraftProblems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-critical-ink">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}

export function PointCalcOverridePanel({
  config,
  draft,
  saving,
  clearing,
  onDraftChange,
  onSave,
  onClear,
  onCancel,
}: Props) {
  // F4.168 OQ-3: the fields share one flag; Save and Clear each announce their
  // own so a screen reader knows which action is running.
  const busy = saving || clearing;
  const problems = draftProblems(draft, config);

  return (
    <div className="surface-raised-sm p-3">
      <PointCalcHeading config={config} />
      <PointCalcSettingsTable config={config} />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PointCalcFormulaFields config={config} draft={draft} busy={busy} onDraftChange={onDraftChange} />
        <PointCalcScheduleFields config={config} draft={draft} busy={busy} onDraftChange={onDraftChange} />
      </div>

      <PointCalcDraftProblems problems={problems} />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canSubmit(draft, config)}
          aria-busy={saving}
          onClick={onSave}
          className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
        >
          {saving ? "Saving override…" : "Save override"}
        </button>
        <button
          type="button"
          // Disabled with nothing overridden: the API returns 404, and an error
          // that says nothing went wrong is the worst kind.
          disabled={busy || !canClear(config)}
          aria-busy={clearing}
          onClick={onClear}
          className="surface-button border border-critical-line px-3 py-1.5 text-critical-ink disabled:opacity-60"
        >
          {clearing ? "Clearing override…" : "Clear override"}
        </button>
        <button
          type="button"
          disabled={busy}
          data-pending-bystander="busy"
          onClick={onCancel}
          className="surface-button px-3 py-1.5 disabled:opacity-60"
        >
          Close
        </button>
      </div>
    </div>
  );
}
