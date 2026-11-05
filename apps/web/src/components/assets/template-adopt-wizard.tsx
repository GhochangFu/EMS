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
 * (`adoptActionState`); should the preview turn refused while Review is open,
 * Review says so and lists the refusals, and Submit sends nothing. A 409 from
 * adopt lists its refusals beside the card and re-reads the preview, so Back
 * shows the server's refusals with Next disabled; a success invalidates what
 * the copilot's `assetTemplate.adopt` does and closes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TemplateAdoptionRefusalDto } from "@bms/shared";
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
  adoptionRefusedBody,
  adoptionVersionChoices,
  type AdoptingAsset,
} from "../../lib/template-adoption";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { AdoptionRefusalList } from "./adoption-refusal-list";

function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.312: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * The adopt wizard for `assets` (one from the points page, up to 25 from the
 * asset list's bulk action). `onDone` runs after a successful adopt, once the
 * adopt's queries are invalidated; `onCancel` when the user leaves.
 */
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
  const previewKey = ["admin", "asset-template-adoption-preview", versionId, assetIds];
  const previewQ = useQuery({
    queryKey: previewKey,
    queryFn: () => previewAdminAssetTemplateAdoption(versionId, assetIds),
    enabled: versionId !== "",
  });
  const preview = previewQ.data ?? null;
  const action = adoptActionState(preview);

  const adoptM = useMutation({
    mutationFn: (ids: string[]) => adoptAdminAssetTemplateAssets(versionId, ids),
    onMutate: () => {
      setError(null);
      setRefused([]);
    },
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
      // The plan the apply re-built is not the one previewed: re-read it, so Back shows the
      // server's refusals and Next follows its `canApply` again.
      void queryClient.invalidateQueries({ queryKey: previewKey });
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
      {/* `F4.315` B1: the verdict first — its "See below." points at the list under it. */}
      {action.message !== null && preview !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {action.message}
        </p>
      ) : null}
      {preview ? <AdoptionRefusalList refusals={preview.refusals} label="Refusals" /> : null}
    </>
  );

  // Review: the 409's refusals when the apply answered one; else, when the preview turned
  // refused while Review was open, the preview's verdict and its refusals.
  const reviewRefusals =
    refused.length > 0 ? (
      <AdoptionRefusalList refusals={refused} label="Refused assets" />
    ) : !action.enabled ? (
      <>
        {action.message !== null ? <p className="text-critical-ink">{action.message}</p> : null}
        <AdoptionRefusalList refusals={preview?.refusals ?? []} label="Refusals" />
      </>
    ) : null;

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
      {versionsQ.isPending ? <p className="text-xs text-ink-muted">Loading the published versions…</p> : null}
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
            // Refused since Next: Review already says why (`reviewRefusals`); nothing is sent.
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
                {reviewRefusals}
              </div>
            ),
          }}
        />
      )}
    </AdminWizardFrame>
  );
}
