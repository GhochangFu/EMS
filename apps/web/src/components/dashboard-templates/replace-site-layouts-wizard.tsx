/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 5, 8, 9 and 10; ADR 0099 Amendment 15) — the
 * apply-to-sites dialog's **Replace existing copies**: the `dashboardTemplate.replaceSiteLayouts`
 * stepper. A bodyless entry, so Review alone; its detail is the bulk preview — every active site
 * of the organization by name, the copy it holds, its edit flag and what will happen — and Submit
 * makes the one body-less POST. The answer lists every site replaced and every site skipped with
 * its reason; a skip is a normal outcome, not an error.
 *
 * The dialog opens for `canAuthorTemplates` roles only (an organization admin or `admin`, the bulk
 * rule of decision 10); the API decides again at Submit.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DashboardTemplateDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import {
  fetchSiteLayoutsReplacePreview,
  replaceSiteLayouts,
  siteLayoutsReplacePreviewKey,
} from "../../api/admin/site-layout-replace";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  editFlagText,
  heldCopyText,
  REPLACE_LOSES,
  REPLACE_OUTCOME_LABELS,
  REPLACE_SKIP_REASON_LABELS,
} from "../../lib/site-layout-replace";
import { WizardShell } from "../wizard/wizard-shell";
import { madeSummary } from "../../lib/site-layout-made-summary";

/** A bodyless wizard's values: it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

export function ReplaceSiteLayoutsWizard({
  template,
  onClose,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const previewQ = useQuery({
    queryKey: siteLayoutsReplacePreviewKey(template.id),
    queryFn: () => fetchSiteLayoutsReplacePreview(template.id),
    retry: false,
  });
  const siteName = (locationId: string): string =>
    previewQ.data?.sites.find((row) => row.locationId === locationId)?.locationName ?? locationId;

  const replaceM = useMutation({
    mutationFn: () => replaceSiteLayouts(template.id),
    onSuccess: () => {
      setError(null);
      // Each rebuilt copy has a new dashboard id: the site views and the dashboards read by slug go stale.
      void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      void queryClient.invalidateQueries({ queryKey: siteLayoutsReplacePreviewKey(template.id) });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });
  const result = replaceM.data;
  const entry = catalogEntry("dashboardTemplate.replaceSiteLayouts")!;

  if (result) {
    return (
      <>
        <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
          {result.replaced.length} site{result.replaced.length === 1 ? "" : "s"} replaced, {result.skipped.length} skipped.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase text-ink-muted">
              <th className="py-1">Site</th>
              <th className="py-1">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-well-deep">
            {result.replaced.map((replaced) => (
              <tr key={replaced.locationId}>
                <td className="py-1 font-semibold">{siteName(replaced.locationId)}</td>
                <td className="py-1">
                  Replaced v{replaced.previousVersion} with v{replaced.version} — {madeSummary(replaced)}
                </td>
              </tr>
            ))}
            {result.skipped.map((skipped) => (
              <tr key={skipped.locationId}>
                <td className="py-1 font-semibold">{siteName(skipped.locationId)}</td>
                <td className="py-1">Skipped — {REPLACE_SKIP_REASON_LABELS[skipped.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            Close
          </button>
        </div>
      </>
    );
  }

  // No confirm without the preview: Submit stays out of the page until the sites, their outcomes
  // and their edit flags are read, so a Replace is never confirmed blind. Cancel only meanwhile.
  if (!previewQ.isSuccess) {
    return (
      <>
        <section aria-label="What Replace changes" className="space-y-2 text-xs text-ink">
          <p className="text-critical-ink">{REPLACE_LOSES}</p>
          {previewQ.isError ? (
            <p role="alert" className="text-critical-ink">
              The sites could not be read: {apiErrorMessage(previewQ.error)}
            </p>
          ) : (
            <p role="status" className="text-ink-muted">
              Reading the sites…
            </p>
          )}
        </section>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            Cancel
          </button>
        </div>
      </>
    );
  }

  const detail = (
    <section aria-label="What Replace changes" className="space-y-2 text-xs text-ink">
      <p className="text-critical-ink">{REPLACE_LOSES}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase text-ink-muted">
            <th className="py-1">Site</th>
            <th className="py-1">Holds</th>
            <th className="py-1">Edits</th>
            <th className="py-1">Will happen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-well-deep">
          {previewQ.data.sites.map((row) => (
            <tr key={row.locationId}>
              <td className="py-1 font-semibold">{row.locationName}</td>
              <td className="py-1">{heldCopyText(row.held)}</td>
              <td className="py-1">{row.held === null ? "—" : editFlagText(row.edits)}</td>
              <td className="py-1">{REPLACE_OUTCOME_LABELS[row.outcome]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <WizardShell
      entry={catalogEntry("dashboardTemplate.replaceSiteLayouts")!}
      params={{ id: template.id }}
      values={NO_VALUES}
      onChange={() => undefined}
      renderStep={() => null}
      onSubmit={() => {
        setError(null);
        replaceM.mutate();
      }}
      onCancel={onClose}
      submitting={replaceM.isPending}
      submitError={error}
      review={{ omit: [], detail }}
      // The template carries no organization name; the sentence names it by its place.
      summary={entry.summary({
        body: {},
        params: { id: template.id },
        targetName: template.name,
        organizationName: "its organization",
      })}
    />
  );
}
