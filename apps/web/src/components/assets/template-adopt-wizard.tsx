/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1, A1 and decisions 2, 3 and 5) — **Adopt
 * a template**: pin template-less assets to one published template version,
 * all or none (`POST /admin/asset-templates/:id/adopt`, the
 * `assetTemplate.adopt` wizard).
 *
 * The version picker sits **outside** the shell: the version is the route's
 * `:id`, not a body field, so it is the record the shell writes (`params`)
 * and the shell restarts when it changes. It offers A1's versions only
 * (`adoptionVersionChoices`); a batch of two organizations or two domains is
 * offered none and told why. The one **Assets** step runs the preview and
 * lists, per asset, the rows kept, added (unmapped), converted (standalone
 * calc → template override) and skipped, the inherited defaults as a plain
 * notice, and every refusal by asset code and point key. Next — the only way
 * to Review's Submit — is disabled until the server's `canApply`
 * (`adoptActionState`). A 409 from adopt lists its refusals beside the card;
 * a success invalidates what the copilot's `assetTemplate.adopt` does and
 * closes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAssetDto, TemplateAdoptionRefusalDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  adoptAdminAssetTemplateAssets,
  fetchAdminAssetTemplates,
  previewAdminAssetTemplateAdoption,
} from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { invalidationKeysFor } from "../../lib/copilot-invalidations";
import {
  adoptActionState,
  adoptionPlanSections,
  adoptionRefusalSentence,
  adoptionRefusedBody,
  adoptionVersionChoices,
} from "../../lib/template-adoption";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";

export type AdoptingAsset = Pick<AdminAssetDto, "id" | "code" | "organizationCode" | "domain" | "templateId">;

function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.312: the catalog has no entry "${id}"`);
  return entry;
}

function RefusalList({ refusals, label }: { refusals: readonly TemplateAdoptionRefusalDto[]; label: string }) {
  if (refusals.length === 0) return null;
  return (
    <ul aria-label={label} className="list-disc space-y-1 pl-4 text-xs text-critical-ink">
      {refusals.map((refusal, index) => (
        <li key={`${refusal.assetId}-${refusal.pointKey ?? ""}-${index}`}>{adoptionRefusalSentence(refusal)}</li>
      ))}
    </ul>
  );
}

export function TemplateAdoptWizard({
  assets,
  onCancel,
  onDone,
}: {
  assets: readonly AdoptingAsset[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [versionId, setVersionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<TemplateAdoptionRefusalDto[]>([]);
  const assetIds = assets.map((asset) => asset.id);

  const versionsQ = useQuery({
    queryKey: ["admin", "asset-templates", "published"],
    queryFn: () => fetchAdminAssetTemplates("published"),
  });
  const choices = adoptionVersionChoices(assets, versionsQ.data?.items ?? []);
  const previewQ = useQuery({
    queryKey: ["admin", "asset-template-adoption-preview", versionId, assetIds],
    queryFn: () => previewAdminAssetTemplateAdoption(versionId, assetIds),
    enabled: versionId !== "",
  });
  const preview = previewQ.data ?? null;
  const action = adoptActionState(preview);

  const adoptM = useMutation({
    mutationFn: (ids: string[]) => adoptAdminAssetTemplateAssets(versionId, ids),
    onSuccess: () => {
      for (const queryKey of invalidationKeysFor("assetTemplate.adopt")) {
        void queryClient.invalidateQueries({ queryKey });
      }
      onDone();
    },
    onError: (cause: unknown) => {
      const body = adoptionRefusedBody(cause);
      setRefused(body?.refusals ?? []);
      setError(
        body === null
          ? apiErrorMessage(cause)
          : `This adoption is refused for ${body.refusalCount} reason(s). Nothing was written.`,
      );
    },
  });

  function pickVersion(next: string): void {
    setError(null);
    setRefused([]);
    setVersionId(next);
  }

  const assetsStep = (
    <>
      {previewQ.isPending ? <p className="text-xs text-ink-muted">Previewing the adoption…</p> : null}
      {previewQ.isError ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(previewQ.error)}
        </p>
      ) : null}
      {preview?.assets.map((plan) => {
        const { groups, notices } = adoptionPlanSections(plan);
        return (
          <section key={plan.assetId} aria-label={`Plan for ${plan.assetCode}`} className="space-y-1 text-xs">
            <p>
              <span className="font-mono">{plan.assetCode}</span> {plan.assetName}
            </p>
            {groups.map((group) => (
              <p key={group.kind}>
                <span className="font-semibold">{group.label}:</span> {group.keys.join(", ")}
              </p>
            ))}
            {notices.map((notice) => (
              <p key={notice} className="text-ink-muted">
                {notice}
              </p>
            ))}
          </section>
        );
      })}
      {preview ? <RefusalList refusals={preview.refusals} label="Refusals" /> : null}
      {action.message !== null && preview !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {action.message}
        </p>
      ) : null}
    </>
  );

  return (
    <AdminWizardFrame title={`Adopt a template for ${assets.length} asset(s)`}>
      <label className={labelClass}>
        Template version
        <select
          className={fieldClass}
          value={versionId}
          disabled={adoptM.isPending || choices.versions.length === 0}
          onChange={(event) => pickVersion(event.target.value)}
        >
          <option value="">Pick a published version</option>
          {choices.versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.code} v{version.version} · {version.name}
            </option>
          ))}
        </select>
      </label>
      {versionsQ.isSuccess && choices.reason !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {choices.reason}
        </p>
      ) : null}
      {versionsQ.isError ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(versionsQ.error)}
        </p>
      ) : null}
      {versionId === "" ? (
        <div className="flex justify-start">
          <button type="button" onClick={onCancel} className="text-xs text-ink-muted underline">
            Cancel
          </button>
        </div>
      ) : (
        <WizardShell
          key={versionId}
          entry={wizardEntry("assetTemplate.adopt")}
          params={{ id: versionId }}
          fixedFields={["assetIds"]}
          values={{ assetIds }}
          onChange={() => undefined}
          renderStep={(step) => (step.id === "assets" ? assetsStep : null)}
          nextDisabled={!action.enabled}
          onSubmit={(body) => {
            if (action.enabled) adoptM.mutate(body.assetIds as string[]);
          }}
          onCancel={() => {
            if (!adoptM.isPending) onCancel();
          }}
          submitting={adoptM.isPending}
          submitError={error}
          review={{
            omit: ["assetIds"],
            detail: (
              <div className="space-y-1 text-xs">
                <p>Assets: {assets.map((asset) => asset.code).join(", ")}</p>
                <RefusalList refusals={refused} label="Refused assets" />
              </div>
            ),
          }}
        />
      )}
    </AdminWizardFrame>
  );
}
