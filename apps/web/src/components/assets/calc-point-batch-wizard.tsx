/**
 * `F4.311` PR 6a (ADR 0109 decisions 4 and 5) — the asset list's bulk action:
 * one calculated point, the same key, formula and timing, on up to
 * `CALC_POINT_BATCH_MAX_ASSETS` template-less assets, all or nothing
 * (`POST /admin/calc-points/batch`, the `calcPoint.createBatch` wizard).
 *
 * The Assets step lists the selection and marks every asset with a template
 * as left out — such an asset takes an override of its template's point, not
 * a point of its own — so the body carries the eligible ids only. Above the
 * cap, or with nothing eligible, Next is disabled and the step says why. The
 * Formula step carries ADR 0109's sentence that a `{ASSET_CODE.key}` formula
 * is tied to one asset. The formula field is the plain input: the selected
 * assets need not share their points, so there is no one key list for the
 * editor's linter, and the server checks each asset and names each refusal.
 * A `400` lists every refused asset on Review, beside the card.
 *
 * `F4.313` (ADR 0109 Amendment 1, A11–A13) — **New key** on the Point step,
 * for a global administrator only (`allowNewKey`). On Submit the wizard first
 * reads each eligible asset's rows and checks the formula against the new
 * code under decision 3's rules, as the Add panel does for one asset; only a
 * clean check creates the key and then writes the batch. A refused batch
 * after the key says the key stays, and the picker re-reads the catalog.
 *
 * `F4.313` follow-up (owner ruling 2026-11-05): the picker lists the eligible
 * assets' domain first when they all share one, and every key when they do not
 * (a left-out asset with a template does not count).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAssetDto, CalcPointBatchBody, CreatePointKeyBody } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { createAdminCalcPointBatch, fetchAdminAssetPoints } from "../../api/admin/asset-points";
import { createAdminPointKey } from "../../api/admin/point-keys";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  BATCH_FORMULA_NOT_CHECKED_CLEAN,
  NEW_KEY,
  batchFormulaRefusals,
  createKeyThenWritePoint,
  emptyNewPointKeyDraft,
  newPointKeyBody,
  newPointKeyDraftChanged,
  newPointKeyProblems,
  pointWriteCause,
  type NewPointKeyDraft,
} from "../../lib/new-point-key-draft";
import {
  BATCH_QUALIFIED_REF_NOTE,
  BATCH_TEMPLATE_EXCLUSION,
  ageTouchedAfter,
  batchCapProblem,
  batchEligibility,
  batchRefusals,
  calcPointDraftChanged,
  calcPointDraftFromFields,
  draftDialect,
  draftToCalcPointBody,
  scheduleStepBlocker,
  withDefaultAge,
  emptyCalcPointDraft,
  standaloneConfigFor,
  type BatchRefusal,
  type CalcPointDraft,
} from "../../lib/calc-point-draft";
import { sharedDomain, sharedValue } from "../../lib/catalog-key-filter";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { FormulaPreview } from "../asset-templates/formula-preview";
import { WizardShell } from "../wizard/wizard-shell";
import { BackfillDaysSelect } from "./backfill-days-select";
import { CatalogKeySelect } from "./catalog-key-select";
import { NewPointKeyFields } from "./new-point-key-fields";
import { PointCalcFormulaFields, PointCalcScheduleFields } from "./point-calc-override-panel";

function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.311: the catalog has no entry "${id}"`);
  return entry;
}

const NOTHING_EXCLUDED: ReadonlySet<string> = new Set();

/** What a fresh wizard holds: `dirty` is any difference from it. */
const START = emptyCalcPointDraft();

export function CalcPointBatchWizard({
  assets,
  allowNewKey = false,
  onCancel,
  onDone,
}: {
  assets: readonly AdminAssetDto[];
  /** `F4.313` (A12): offer **New key** — the page passes it for a global administrator only. */
  allowNewKey?: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CalcPointDraft>(() => emptyCalcPointDraft());
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<BatchRefusal[]>([]);
  // `F4.313`: the New key fields while **New key** is picked; the draft's key mirrors their code.
  const [newKey, setNewKey] = useState<NewPointKeyDraft | null>(null);
  const [checking, setChecking] = useState(false);
  // `F4.315` B4: "Inputs valid for" follows the default until someone chooses one.
  const [ageTouched, setAgeTouched] = useState(false);
  const { eligible } = batchEligibility(assets);
  const capProblem = batchCapProblem(assets.length);
  const blocker =
    capProblem ??
    (eligible.length === 0 ? "None of the selected assets can take a calculated point of its own." : null);
  const codeOf = new Map(assets.map((asset) => [asset.id, asset.code]));

  // Re-read on every outcome: under ruling 4 a `409` / `503` arrives with
  // every point already written, so a refusal is no proof nothing changed.
  // The wizard stays open on a refusal, with the server's sentence.
  // `F4.313` (A13): with a new key, the key first and then the batch; a
  // refused batch leaves the key in the catalog, so the picker re-reads it.
  const batchM = useMutation({
    mutationFn: ({ body, key }: { body: CalcPointBatchBody; key: CreatePointKeyBody | null }) =>
      createKeyThenWritePoint(key, createAdminPointKey, () => createAdminCalcPointBatch(body)),
    onSettled: (_data, _cause, { key }) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-calc-points"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      if (key !== null) void queryClient.invalidateQueries({ queryKey: ["admin", "point-keys"] });
    },
    onSuccess: () => onDone(),
    onError: (cause: unknown) => {
      setRefused(batchRefusals(pointWriteCause(cause)) ?? []);
      setError(apiErrorMessage(cause));
    },
  });

  /**
   * A13 for the batch: the new key's fields, then the formula against each
   * eligible asset's rows under the new code; only a clean check writes.
   */
  async function submitWithNewKey(body: CalcPointBatchBody, keyDraft: NewPointKeyDraft): Promise<void> {
    const keyProblems = newPointKeyProblems(keyDraft);
    if (keyProblems.length > 0) {
      setError(keyProblems.join(" "));
      return;
    }
    setChecking(true);
    try {
      const rows = await Promise.all(
        eligible.map((asset) =>
          queryClient.fetchQuery({
            queryKey: ["admin", "asset-points", "all", asset.id],
            queryFn: () => fetchAdminAssetPoints("all", asset.id),
          }),
        ),
      );
      const found = batchFormulaRefusals(
        eligible,
        new Map(eligible.map((asset, index) => [asset.id, rows[index]?.items ?? []])),
        draft,
      );
      if (found.length > 0) {
        setRefused(found);
        setError(BATCH_FORMULA_NOT_CHECKED_CLEAN);
        return;
      }
    } catch (cause: unknown) {
      setError(apiErrorMessage(cause));
      return;
    } finally {
      setChecking(false);
    }
    batchM.mutate({ body, key: newPointKeyBody(keyDraft) });
  }

  const change = (next: CalcPointDraft) => {
    setError(null);
    setRefused([]);
    setDraft(next);
  };
  const changeTiming = (next: CalcPointDraft) => {
    const touched = ageTouchedAfter(draft, next, ageTouched);
    setAgeTouched(touched);
    change(withDefaultAge(next, touched));
  };
  const busy = batchM.isPending || checking;
  const pickKey = (picked: string) => {
    setNewKey(picked === NEW_KEY ? emptyNewPointKeyDraft() : null);
    change({ ...draft, pointKey: picked === NEW_KEY ? "" : picked });
  };
  const editNewKey = (next: NewPointKeyDraft) => {
    setNewKey(next);
    change({ ...draft, pointKey: next.code.trim() });
  };
  const fields = {
    config: standaloneConfigFor(draft.pointKey),
    draft,
    busy,
    standalone: true,
    onDraftChange: (next: Partial<CalcPointDraft>) => changeTiming({ ...draft, ...next }),
  };
  const values: Record<string, unknown> = {
    assetIds: eligible.map((asset) => asset.id),
    pointKey: draft.pointKey === "" ? undefined : draft.pointKey,
    ...draftToCalcPointBody(draft),
  };
  const assetsStep = (
    <>
      <ul className="space-y-1 text-xs">
        {assets.map((asset) => (
          <li key={asset.id} className="flex justify-between gap-2">
            <span>
              <span className="font-mono">{asset.code}</span> {asset.name}
            </span>
            {asset.templateId === null ? null : (
              <span className="text-ink-muted">left out: {BATCH_TEMPLATE_EXCLUSION}</span>
            )}
          </li>
        ))}
      </ul>
      {blocker ? (
        <p role="alert" className="text-xs text-critical-ink">
          {blocker}
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          {eligible.length} of {assets.length} selected asset(s) get the point, all or none.
        </p>
      )}
    </>
  );
  const pointStep = (
    <>
      <CatalogKeySelect
        value={newKey ? NEW_KEY : draft.pointKey}
        exclude={NOTHING_EXCLUDED}
        disabled={busy}
        allowNew={allowNewKey}
        domain={sharedDomain(eligible.map((asset) => asset.domain))}
        onChange={pickKey}
      />
      {newKey ? <NewPointKeyFields draft={newKey} disabled={busy} onChange={editNewKey} /> : null}
    </>
  );
  // `F4.314` PR 2 (A3): no single asset, so nothing is marked missing, and
  // the organization's versions are read only when the eligible assets share
  // one organization and one domain (an asset with no organization reads none).
  const suggestions = {
    organizationCode: sharedValue(eligible.map((asset) => asset.organizationCode)),
    domain: sharedDomain(eligible.map((asset) => asset.domain)),
    assetKeys: null,
  };
  const formulaStep = (
    <>
      <p className="text-xs text-ink-muted">{BATCH_QUALIFIED_REF_NOTE}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <PointCalcFormulaFields {...fields} suggestions={suggestions} />
      </div>
      <FormulaPreview expression={draft.formula} dialect={draftDialect(draft)} disabled={busy} />
    </>
  );
  const scheduleStep = (
    <div className="grid gap-2 sm:grid-cols-2">
      <PointCalcScheduleFields {...fields} />
    </div>
  );
  const backfillStep = (
    <BackfillDaysSelect
      value={draft.backfillDays}
      disabled={busy}
      onChange={(days) => change({ ...draft, backfillDays: days })}
    />
  );
  const steps: Record<string, JSX.Element> = {
    assets: assetsStep,
    point: pointStep,
    formula: formulaStep,
    schedule: scheduleStep,
    backfill: backfillStep,
  };

  return (
    <AdminWizardFrame title={`Add calculated point to ${eligible.length} asset(s)`}>
      <WizardShell
        entry={wizardEntry("calcPoint.createBatch")}
        params={{}}
        fixedFields={["assetIds"]}
        values={values}
        onChange={(next) =>
          changeTiming(calcPointDraftFromFields(next, typeof next.pointKey === "string" ? next.pointKey : ""))
        }
        renderStep={(step) => steps[step.id] ?? null}
        nextDisabled={blocker !== null}
        stepBlocker={(step) => (step.id === "schedule" ? scheduleStepBlocker(draft) : null)}
        onSubmit={(body) => {
          if (newKey) void submitWithNewKey(body as CalcPointBatchBody, newKey);
          else batchM.mutate({ body: body as CalcPointBatchBody, key: null });
        }}
        onCancel={() => {
          if (!busy) onCancel();
        }}
        submitting={busy}
        submitError={error}
        dirty={calcPointDraftChanged(draft, START) || (newKey !== null && newPointKeyDraftChanged(newKey))}
        review={{
          omit: ["assetIds"],
          detail: (
            <div className="space-y-1 text-xs">
              <p>Assets: {eligible.map((asset) => asset.code).join(", ")}</p>
              {refused.length > 0 ? (
                <ul aria-label="Refused assets" className="list-disc space-y-1 pl-4 text-critical-ink">
                  {refused.map((row) => (
                    <li key={row.assetId}>
                      <span className="font-mono">{row.assetCode ?? codeOf.get(row.assetId) ?? row.assetId}</span>:{" "}
                      {row.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ),
        }}
      />
    </AdminWizardFrame>
  );
}
