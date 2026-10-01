/**
 * The site template's bulk action, "Apply to all sites" (`F3.73` ruling Q4, ADR 0087): the
 * confirm, the one POST, and the per-site result table.
 *
 * Moved out of `dashboard-template-detail-page.tsx` to keep that page under the AGENTS.md §4
 * file cap, with no change in behaviour. `madeSummary` and `useSiteLocations` live here because
 * this dialog is their main caller; the page's single-site instantiate dialog imports both, so
 * one site's copy reads the same in both places and the two dialogs share one locations query.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  DashboardTemplateDto,
  SiteLayoutResultDto,
  SiteLayoutSkipReason,
} from "@bms/shared";

import { applySiteTemplate } from "../../api/admin/dashboard-templates";
import { fetchAdminLocations } from "../../api/admin/locations";
import { apiErrorMessage } from "../../lib/api-error-message";

/** The sites an organization holds, for the site arm's picker and its result's names. */
export function useSiteLocations(template: DashboardTemplateDto) {
  return useQuery({
    queryKey: ["admin", "locations", "true", template.organizationId],
    queryFn: () => fetchAdminLocations("true", template.organizationId),
  });
}

/** One sentence per skip reason of the bulk action — a closed record, so a new reason fails to compile here. */
const SKIP_REASON_LABELS: Record<SiteLayoutSkipReason, string> = {
  has_view: "The site already has a site view",
  ambiguous: "A tab matches two or more asset groups — make this site's layout by hand to choose",
  no_assets: "The site has no assets to bind",
  slug_taken: "Another site already holds this dashboard slug",
};

/**
 * What one site's copy did, in one cell: the kept tabs, any tab the site could not hold, and any
 * role tile left out because it binds no point at the site (ADR 0087 Amendment 2).
 */
export function madeSummary(made: SiteLayoutResultDto): string {
  const kept = `${made.resolution.length} tab${made.resolution.length === 1 ? "" : "s"}`;
  const tabs = made.omittedTabs.length > 0 ? `, ${made.omittedTabs.length} omitted (no matching group)` : "";
  const tiles = made.omittedTiles.length;
  const left = tiles > 0 ? `, ${tiles} tile${tiles === 1 ? "" : "s"} left out (no point at the site)` : "";
  return `Made — ${kept}${tabs}${left}`;
}

/**
 * `F3.73` ruling Q4 — "Apply to all sites": confirm, then one POST. The answer lists every site
 * the action made a copy for and every site it skipped, each skip with its reason — a skipped
 * site is a normal outcome of the action, not an error, and a report that hid it would read as
 * every site done.
 */
export function ApplyToSitesDialog({
  template,
  onClose,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const locationsQ = useSiteLocations(template);
  const siteName = (locationId: string): string =>
    locationsQ.data?.items.find((location) => location.id === locationId)?.name ?? locationId;

  const applyM = useMutation({
    mutationFn: () => applySiteTemplate(template.id),
    onSuccess: () => {
      setError(null);
      // The copies are the sites' views now; a cached site view read must not outlive them.
      void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });
  const result = applyM.data;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Apply {template.code} v{template.version} to all sites
        </h2>
        {result ? (
          <>
            <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
              {result.made.length} site{result.made.length === 1 ? "" : "s"} made,{" "}
              {result.skipped.length} skipped.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase text-ink-muted">
                  <th className="py-1">Site</th>
                  <th className="py-1">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-well-deep">
                {result.made.map((made) => (
                  <tr key={made.locationId}>
                    <td className="py-1 font-semibold">{siteName(made.locationId)}</td>
                    <td className="py-1">{madeSummary(made)}</td>
                  </tr>
                ))}
                {result.skipped.map((skipped) => (
                  <tr key={skipped.locationId}>
                    <td className="py-1 font-semibold">{siteName(skipped.locationId)}</td>
                    <td className="py-1">Skipped — {SKIP_REASON_LABELS[skipped.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p className="max-w-prose text-xs text-ink-muted">
              This copies the template onto every active site of its organization, one site at a
              time. A site that already has a site view, has no assets, or has a tab that matches
              two or more asset groups is skipped and listed.
            </p>
            {error ? (
              <p className="rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
                {error}
              </p>
            ) : null}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            {result ? "Close" : "Cancel"}
          </button>
          {!result ? (
            <button
              type="button"
              aria-label={applyM.isPending ? "Applying…" : "Confirm apply to all sites"}
              disabled={applyM.isPending}
              aria-busy={applyM.isPending}
              onClick={() => {
                setError(null);
                applyM.mutate();
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
            >
              {applyM.isPending ? "Applying…" : "Apply"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
