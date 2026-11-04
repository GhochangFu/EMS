/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — a calculated point of the asset's
 * own, on an asset with **no** template: Add, Edit and Delete on the asset's
 * points page.
 *
 * The form is the `calcPoint.set` wizard (Formula → Schedule → Backfill →
 * Review), rendered through `WizardShell` the way the override's
 * `calcOverride.set` wizard is (`asset-points-page.tsx`), from the override
 * panel's own field parts in their `standalone` form — no `inherit (…)`
 * option and no template placeholder, because there is no template. The
 * formula field is the lazy editor in its derived mode over the asset's own
 * points, with the live preview under it (ADR 0038 decision 5). Delete is the
 * `calcPoint.delete` wizard: Review alone.
 *
 * Every rule is in `lib/calc-point-draft.ts` (the coverage gate reaches
 * `src/lib/**`); this file is presentation. The page owns the writes, so a
 * refusal — a `409` on Delete for a point a dashboard widget shows, included
 * — is the Review card's error in the server's words.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CALC_DIALECT, CALC_DIALECTS } from "@bms/shared";
import type { AssetPointCalcConfigDto, CalcPointSetBody } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminAssetPoints } from "../../api/admin/asset-points";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import {
  BACKFILL_DAY_CHOICES,
  calcPointDraftFromConfig,
  calcPointDraftFromFields,
  calcPointDraftProblems,
  draftToCalcPointBody,
  emptyCalcPointDraft,
  formulaPointsFor,
  knownRefsFor,
  standaloneConfigFor,
  type CalcPointDraft,
} from "../../lib/calc-point-draft";
import { FormulaEditorLazy } from "../asset-templates/formula-editor-lazy";
import { FormulaPreview } from "../asset-templates/formula-preview";
import { WizardShell } from "../wizard/wizard-shell";
import {
  PointCalcDraftProblems,
  PointCalcFormulaFields,
  PointCalcHeading,
  PointCalcScheduleFields,
} from "./point-calc-override-panel";

/** The catalog entry a wizard submits, or a build defect (the `asset-points-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.311: the catalog has no entry "${id}"`);
  return entry;
}

/** The dialect the draft is written in — the Grammar select's value, never `""` on a standalone point. */
export function draftDialect(draft: CalcPointDraft) {
  return CALC_DIALECTS.find((known) => known === draft.formulaDialect) ?? CALC_DIALECT;
}

/** The catalog key a new point writes (`fetchAdminPointKeys("true")`, the asset-point wizard's read). */
export function CatalogKeySelect({
  value,
  exclude,
  disabled,
  onChange,
}: {
  value: string;
  exclude: ReadonlySet<string>;
  disabled: boolean;
  onChange: (pointKey: string) => void;
}) {
  // `F3.39`: one fleet-wide catalog, so no organization in the key.
  const catalogQ = useQuery({ queryKey: ["admin", "point-keys", "true"], queryFn: () => fetchAdminPointKeys("true") });
  return (
    <label className="block text-xs">
      <span className="text-ink-muted">Point key</span>
      <select
        aria-label="Point key"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full surface-field px-2 py-1"
      >
        <option value="">Select catalog point key</option>
        {(catalogQ.data?.items ?? [])
          .filter((item) => !exclude.has(item.code))
          .map((item) => (
            <option key={item.id} value={item.code}>
              {item.code} · {item.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/** ADR 0109 decision 7 — days of history to compute on save; "None" sends no field. */
export function BackfillDaysSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (days: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-ink-muted">Backfill history</span>
      <select
        aria-label="Backfill history"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full surface-field px-2 py-1"
      >
        <option value="">None</option>
        {BACKFILL_DAY_CHOICES.map((days) => (
          <option key={days} value={String(days)}>
            {days === 1 ? "1 day" : `${days} days`}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-ink-muted">
        Computes the point over this many past days when you save. Stored readings are never overwritten.
      </span>
    </label>
  );
}

type CalcPointPanelProps = {
  assetId: string;
  /** The stored point on Edit; `null` on Add. */
  config: AssetPointCalcConfigDto | null;
  saving: boolean;
  saveError: string | null;
  /** The draft changed: a refusal of the previous one is stale. */
  onEdited: () => void;
  onSubmit: (pointKey: string, body: CalcPointSetBody) => void;
  /** Edit only: opens the `calcPoint.delete` wizard. */
  onDelete: (() => void) | null;
  onCancel: () => void;
};

/** Add or Edit one standalone calculated point — the `calcPoint.set` wizard. */
export function CalcPointPanel({
  assetId,
  config,
  saving,
  saveError,
  onEdited,
  onSubmit,
  onDelete,
  onCancel,
}: CalcPointPanelProps) {
  const [draft, setDraft] = useState<CalcPointDraft>(() =>
    config ? calcPointDraftFromConfig(config) : emptyCalcPointDraft(),
  );
  const rowsQ = useQuery({
    queryKey: ["admin", "asset-points", "all", assetId],
    queryFn: () => fetchAdminAssetPoints("all", assetId),
  });
  const rows = rowsQ.data?.items ?? [];
  const change = (next: CalcPointDraft) => {
    onEdited();
    setDraft(next);
  };
  const problems = calcPointDraftProblems(draft, knownRefsFor(rows, draft.pointKey));
  const dialect = draftDialect(draft);
  const fieldsConfig = config ?? standaloneConfigFor(draft.pointKey);
  const fields = {
    config: fieldsConfig,
    draft,
    busy: saving,
    standalone: true,
    onDraftChange: (next: Partial<CalcPointDraft>) => change({ ...draft, ...next }),
  };
  // Built here, not inside `renderStep`: stable elements keep a select's
  // first pick (the override wizard's note in `asset-points-page.tsx`).
  const formulaStep = (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <PointCalcFormulaFields
          {...fields}
          formulaEditor={
            <FormulaEditorLazy
              mode="derived"
              points={formulaPointsFor(rows)}
              selfPointKey={draft.pointKey}
              dialect={dialect}
              value={draft.formula}
              readOnly={saving}
              ariaLabel={`Formula for ${draft.pointKey}`}
              onChange={(next) => change({ ...draft, formula: next })}
            />
          }
        />
      </div>
      <FormulaPreview expression={draft.formula} dialect={dialect} disabled={saving} />
      <PointCalcDraftProblems problems={problems} />
    </>
  );
  const scheduleStep = (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <PointCalcScheduleFields {...fields} />
      </div>
      <PointCalcDraftProblems problems={problems} />
    </>
  );
  const backfillStep = (
    <BackfillDaysSelect
      value={draft.backfillDays}
      disabled={saving}
      onChange={(days) => change({ ...draft, backfillDays: days })}
    />
  );
  return (
    <div className="surface-raised-sm flex flex-col gap-3 p-3">
      {config ? (
        <PointCalcHeading config={config} />
      ) : (
        <>
          <h3 className="text-sm font-semibold">Add calculated point</h3>
          <CatalogKeySelect
            value={draft.pointKey}
            exclude={new Set(rows.map((row) => row.pointKey))}
            disabled={saving}
            onChange={(pointKey) => change({ ...draft, pointKey })}
          />
        </>
      )}
      {draft.pointKey === "" ? (
        <div className="flex justify-start">
          <button type="button" onClick={onCancel} className="text-xs text-ink-muted underline">
            Cancel
          </button>
        </div>
      ) : (
        <WizardShell
          entry={wizardEntry("calcPoint.set")}
          params={{ assetId, pointKey: draft.pointKey }}
          values={{ ...draftToCalcPointBody(draft) }}
          onChange={(values) => change(calcPointDraftFromFields(values, draft.pointKey))}
          renderStep={(step) =>
            step.id === "formula" ? formulaStep : step.id === "schedule" ? scheduleStep : backfillStep
          }
          // The body Review parsed against `calcPointSetBodySchema`, sent as shown.
          onSubmit={(body) => {
            if (problems.length === 0) onSubmit(draft.pointKey, body as CalcPointSetBody);
          }}
          onCancel={() => {
            if (!saving) onCancel();
          }}
          submitting={saving}
          submitError={saveError ?? (problems.length > 0 ? problems.join(" ") : null)}
          current={config?.override ?? null}
        />
      )}
      {onDelete ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            className="surface-button border border-critical-line px-3 py-1.5 text-xs text-critical-ink disabled:opacity-60"
          >
            Delete calculated point
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A Review-only wizard has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/**
 * `calcPoint.delete` — Review alone. Submit hands the `DELETE` to the page; a
 * refusal (`409`: the point is on a dashboard widget) is `error`, the
 * server's sentence.
 */
export function CalcPointDeleteWizard({
  assetId,
  pointKey,
  assetLabel,
  deleting,
  error,
  onSubmit,
  onCancel,
}: {
  assetId: string;
  pointKey: string;
  assetLabel: string;
  deleting: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const entry = wizardEntry("calcPoint.delete");
  const params = { assetId, pointKey };
  return (
    <div className="surface-raised-sm flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold">Delete {pointKey}</h3>
      <WizardShell
        entry={wizardEntry("calcPoint.delete")}
        params={params}
        values={NO_VALUES}
        onChange={() => undefined}
        renderStep={() => null}
        onSubmit={() => {
          if (!deleting) onSubmit();
        }}
        onCancel={() => {
          if (!deleting) onCancel();
        }}
        submitting={deleting}
        submitError={error}
        summary={entry.summary({ body: NO_VALUES, params, targetName: assetLabel, organizationName: "" })}
      />
    </div>
  );
}
