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
 * `calcPoint.delete` wizard (`calc-point-delete-wizard.tsx`): Review alone.
 *
 * Every rule is in `lib/calc-point-draft.ts` (the coverage gate reaches
 * `src/lib/**`); this file is presentation. The page owns the writes, so a
 * refusal — a `409` on Delete for a point a dashboard widget shows, included
 * — is the Review card's error in the server's words.
 *
 * `F4.313` (ADR 0109 Amendment 1, A11–A13) — on Add, a global administrator
 * (`allowNewKey`) may pick **New key** and type its code, label and unit. The
 * formula is then checked against the new code, with the key's own fields,
 * and only a clean draft reaches `onSubmit` with the key to create; the page
 * creates it and then writes the point (`createKeyThenWritePoint`).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AssetPointCalcConfigDto, CalcPointSetBody, CreatePointKeyBody } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminAssetPoints } from "../../api/admin/asset-points";
import {
  ageTouchedAfter,
  calcPointDraftChanged,
  calcPointDraftFromConfig,
  calcPointDraftFromFields,
  calcPointDraftProblems,
  draftDialect,
  draftToCalcPointBody,
  scheduleStepBlocker,
  withDefaultAge,
  emptyCalcPointDraft,
  formulaPointsFor,
  knownRefsFor,
  standaloneConfigFor,
  type CalcPointDraft,
} from "../../lib/calc-point-draft";
import {
  NEW_KEY,
  emptyNewPointKeyDraft,
  newKeyClashProblem,
  newPointKeyBody,
  newPointKeyDraftChanged,
  newPointKeyProblems,
  type NewPointKeyDraft,
} from "../../lib/new-point-key-draft";
import { FormulaEditorLazy } from "../asset-templates/formula-editor-lazy";
import { FormulaPreview } from "../asset-templates/formula-preview";
import { WizardShell } from "../wizard/wizard-shell";
import { BackfillDaysSelect } from "./backfill-days-select";
import { CatalogKeySelect } from "./catalog-key-select";
import { NewPointKeyFields } from "./new-point-key-fields";
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

type CalcPointPanelProps = {
  assetId: string;
  /** The stored point on Edit; `null` on Add. */
  config: AssetPointCalcConfigDto | null;
  saving: boolean;
  saveError: string | null;
  /** The draft changed: a refusal of the previous one is stale. */
  onEdited: () => void;
  /**
   * `F4.313` (A13): `newKey` is the catalog key to create first, or `null`.
   * Called only once the formula checks clean against the key it names.
   */
  onSubmit: (pointKey: string, body: CalcPointSetBody, newKey: CreatePointKeyBody | null) => void;
  /** `F4.313` (A12): offer **New key** on Add — the page passes it for a global administrator only. */
  allowNewKey?: boolean;
  /** `F4.313` follow-up: the asset's domain, so Add lists its keys first; `null` lists all. */
  assetDomain?: string | null;
  /** `F4.314` PR 2: the asset's organization code, whose published versions Add's Suggested formulas read. */
  assetOrganizationCode?: string | null;
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
  allowNewKey = false,
  assetDomain = null,
  assetOrganizationCode = null,
  onDelete,
  onCancel,
}: CalcPointPanelProps) {
  const [draft, setDraft] = useState<CalcPointDraft>(() =>
    config ? calcPointDraftFromConfig(config) : emptyCalcPointDraft(),
  );
  // `F4.313`: the New key fields while **New key** is picked; the draft's key mirrors their code.
  const [newKey, setNewKey] = useState<NewPointKeyDraft | null>(null);
  const rowsQ = useQuery({
    queryKey: ["admin", "asset-points", "all", assetId],
    queryFn: () => fetchAdminAssetPoints("all", assetId),
  });
  const rows = rowsQ.data?.items ?? [];
  const change = (next: CalcPointDraft) => {
    onEdited();
    setDraft(next);
  };
  // `F4.315` B4: Add's "Inputs valid for" follows the default until someone chooses one; Edit's is stored.
  const [ageTouched, setAgeTouched] = useState(config !== null);
  const changeTiming = (next: CalcPointDraft) => {
    const touched = ageTouchedAfter(draft, next, ageTouched);
    setAgeTouched(touched);
    change(withDefaultAge(next, touched));
  };
  // A13: the formula is checked against the key it names — the new code on
  // New key — and the new key's own fields, before any write.
  const problems = [
    ...(newKey ? newPointKeyProblems(newKey) : []),
    ...(newKey ? [newKeyClashProblem(newKey.code, rows.map((row) => row.pointKey))].filter((p) => p !== null) : []),
    ...calcPointDraftProblems(draft, knownRefsFor(rows, draft.pointKey)),
  ];
  const dialect = draftDialect(draft);
  // The leave prompt's `dirty`: the shell never sees the CodeMirror formula's
  // edits (no DOM `change`), and on Add the key select sits outside it.
  const dirty =
    calcPointDraftChanged(draft, config ? calcPointDraftFromConfig(config) : emptyCalcPointDraft(draft.pointKey)) ||
    (newKey !== null && newPointKeyDraftChanged(newKey));
  const pickKey = (picked: string) => {
    setNewKey(picked === NEW_KEY ? emptyNewPointKeyDraft() : null);
    change({ ...draft, pointKey: picked === NEW_KEY ? "" : picked });
  };
  const editNewKey = (next: NewPointKeyDraft) => {
    setNewKey(next);
    change({ ...draft, pointKey: next.code.trim() });
  };
  const fieldsConfig = config ?? standaloneConfigFor(draft.pointKey);
  const fields = {
    config: fieldsConfig,
    draft,
    busy: saving,
    standalone: true,
    onDraftChange: (next: Partial<CalcPointDraft>) => changeTiming({ ...draft, ...next }),
  };
  // Built here, not inside `renderStep`: stable elements keep a select's
  // first pick (the override wizard's note in `asset-points-page.tsx`).
  const formulaStep = (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <PointCalcFormulaFields
          {...fields}
          // `F4.314` PR 2 (A3): Add offers the key's existing formulas,
          // marking the inputs this asset's rows do not have.
          suggestions={
            config
              ? undefined
              : { organizationCode: assetOrganizationCode, domain: assetDomain, assetKeys: rows.map((row) => row.pointKey) }
          }
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
            value={newKey ? NEW_KEY : draft.pointKey}
            exclude={new Set(rows.map((row) => row.pointKey))}
            disabled={saving}
            allowNew={allowNewKey}
            domain={assetDomain}
            onChange={pickKey}
          />
          {newKey ? <NewPointKeyFields draft={newKey} disabled={saving} onChange={editNewKey} /> : null}
        </>
      )}
      {draft.pointKey === "" && newKey === null ? (
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
          onChange={(values) => changeTiming(calcPointDraftFromFields(values, draft.pointKey))}
          renderStep={(step) =>
            step.id === "formula" ? formulaStep : step.id === "schedule" ? scheduleStep : backfillStep
          }
          // The body Review parsed against `calcPointSetBodySchema`, sent as shown.
          onSubmit={(body) => {
            if (problems.length === 0)
              onSubmit(draft.pointKey, body as CalcPointSetBody, newKey ? newPointKeyBody(newKey) : null);
          }}
          onCancel={() => {
            if (!saving) onCancel();
          }}
          submitting={saving}
          submitError={saveError ?? (problems.length > 0 ? problems.join(" ") : null)}
          current={config?.override ?? null}
          dirty={dirty}
          stepBlocker={(step) => (step.id === "schedule" ? scheduleStepBlocker(draft) : null)}
        />
      )}
      {onDelete ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            // Opens the delete wizard; it never pends itself, so it keeps its name while Save does.
            data-pending-bystander="saving"
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
