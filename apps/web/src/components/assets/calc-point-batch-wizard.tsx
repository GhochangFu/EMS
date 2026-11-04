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
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAssetDto, CalcPointBatchBody } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { createAdminCalcPointBatch } from "../../api/admin/asset-points";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  BATCH_QUALIFIED_REF_NOTE,
  BATCH_TEMPLATE_EXCLUSION,
  batchCapProblem,
  batchEligibility,
  batchRefusals,
  calcPointDraftChanged,
  calcPointDraftFromFields,
  draftDialect,
  draftToCalcPointBody,
  emptyCalcPointDraft,
  standaloneConfigFor,
  type BatchRefusal,
  type CalcPointDraft,
} from "../../lib/calc-point-draft";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { FormulaPreview } from "../asset-templates/formula-preview";
import { WizardShell } from "../wizard/wizard-shell";
import { BackfillDaysSelect } from "./backfill-days-select";
import { CatalogKeySelect } from "./catalog-key-select";
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
  onCancel,
  onDone,
}: {
  assets: readonly AdminAssetDto[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CalcPointDraft>(() => emptyCalcPointDraft());
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<BatchRefusal[]>([]);
  const { eligible } = batchEligibility(assets);
  const capProblem = batchCapProblem(assets.length);
  const blocker =
    capProblem ??
    (eligible.length === 0 ? "None of the selected assets can take a calculated point of its own." : null);
  const codeOf = new Map(assets.map((asset) => [asset.id, asset.code]));

  // Re-read on every outcome: under ruling 4 a `409` / `503` arrives with
  // every point already written, so a refusal is no proof nothing changed.
  // The wizard stays open on a refusal, with the server's sentence.
  const batchM = useMutation({
    mutationFn: (body: CalcPointBatchBody) => createAdminCalcPointBatch(body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-calc-points"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
    onSuccess: () => onDone(),
    onError: (cause: unknown) => {
      setRefused(batchRefusals(cause) ?? []);
      setError(apiErrorMessage(cause));
    },
  });

  const change = (next: CalcPointDraft) => {
    setError(null);
    setRefused([]);
    setDraft(next);
  };
  const busy = batchM.isPending;
  const fields = {
    config: standaloneConfigFor(draft.pointKey),
    draft,
    busy,
    standalone: true,
    onDraftChange: (next: Partial<CalcPointDraft>) => change({ ...draft, ...next }),
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
    <CatalogKeySelect
      value={draft.pointKey}
      exclude={NOTHING_EXCLUDED}
      disabled={busy}
      onChange={(pointKey) => change({ ...draft, pointKey })}
    />
  );
  const formulaStep = (
    <>
      <p className="text-xs text-ink-muted">{BATCH_QUALIFIED_REF_NOTE}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <PointCalcFormulaFields {...fields} />
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
          change(calcPointDraftFromFields(next, typeof next.pointKey === "string" ? next.pointKey : ""))
        }
        renderStep={(step) => steps[step.id] ?? null}
        nextDisabled={blocker !== null}
        onSubmit={(body) => batchM.mutate(body as CalcPointBatchBody)}
        onCancel={() => {
          if (!busy) onCancel();
        }}
        submitting={busy}
        submitError={error}
        dirty={calcPointDraftChanged(draft, START)}
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
