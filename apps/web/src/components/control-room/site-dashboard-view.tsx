import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardDto } from "@bms/shared";
import { Link, Navigate } from "react-router-dom";

import { fetchDashboard } from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import { DashboardLiveCanvas } from "../dashboards/dashboard-live-canvas";
import { TAB_FOCUS_CLASS } from "../dashboards/dashboard-tab-strip";
import { SectionCard } from "../section-card";
import { siteTabHref } from "../widgets/site-widget-parts";

type SiteDashboardViewProps = {
  slug: string;
  organizationId: string;
  /** The site the page renders; the tab links and the redirect are built on its path. */
  locationId: string;
  /** The route's raw `:tab` segment (`undefined` at the bare path); never `assets`, the page owns it. */
  tab: string | undefined;
};

/**
 * The site page's resolve read is keyed `["control-room", "site-view", locationId]`
 * (`pages/control-room/site-page.tsx`). This view is handed the slug, not the
 * location id, so `Try again` invalidates by the stable prefix: only the
 * mounted site page's read is active, so only it refetches.
 */
const SITE_VIEW_RESOLVE_PREFIX = ["control-room", "site-view"] as const;

/**
 * `F3.69` U2 (plan decision D3) — the site's configured dashboard, rendered
 * inline on `/control-room/site/:locationId` under the site page's own
 * breadcrumb, header and notice banner.
 *
 * The read shares the dashboard viewer's key, so the two share one cache
 * entry. The organization id is the site's: the resolver already proved the
 * dashboard belongs to it (ADR 0076 decision 5). Access is not re-decided
 * here (D6) — a refusal is a failed read like any other.
 *
 * **A failed read (owner ruling OQ2 (a))** renders an inline alert with the
 * API's message and a `Try again` that re-reads the dashboard and invalidates
 * the site page's resolve read: a dashboard deleted between the two reads
 * then flips the page to the generated view with the API's
 * `dashboard_removed` notice. The fail-safe rule stays in the API; this view
 * never falls back to the generated view itself.
 *
 * **It decides from the data, not the status** — as `site-page.tsx` does. A
 * background refetch that fails after an answer (a window refocus during an
 * API restart) sets `isError` with `data` kept, and the canvas stays; the
 * alert shows only when no answer ever arrived.
 *
 * **No Edit link (owner ruling OQ1 (a)).** `Open in Dashboards` goes to the
 * viewer, which holds the Edit link behind `canAuthorDashboards`.
 *
 * **Tabs (`F3.73` plan D10).** This view owns the `:tab` decision for the `dashboard` kind;
 * the site page's D5 redirect no longer fires for it. Once the read has data: a dashboard with
 * tabs shows a strip under the section title (one link per tab by `sortOrder`, the selected one
 * `aria-current="page"`), the bare path selects the first tab in place, and the canvas renders
 * the selected tab's widgets only. A segment that names no tab — on any dashboard, including
 * one with no tabs — redirects to the bare path. A dashboard with no tabs renders as before.
 * A pending or rejected read redirects nowhere.
 */
export function SiteDashboardView({ slug, organizationId, locationId, tab }: SiteDashboardViewProps) {
  const queryClient = useQueryClient();
  const dashboardQ = useQuery({
    queryKey: ["dashboards", "detail", slug, organizationId],
    queryFn: () => fetchDashboard(slug, organizationId),
  });

  const tryAgain = () => {
    void queryClient.invalidateQueries({ queryKey: [...SITE_VIEW_RESOLVE_PREFIX] });
    void dashboardQ.refetch();
  };

  const sitePath = `/control-room/site/${encodeURIComponent(locationId)}`;
  const tabs = dashboardQ.data === undefined ? [] : sortedTabs(dashboardQ.data);
  const selected = tab === undefined ? tabs[0] : tabs.find((candidate) => candidate.key === tab);

  if (dashboardQ.data !== undefined && tab !== undefined && selected === undefined) {
    return <Navigate to={sitePath} replace />;
  }

  return (
    <SectionCard
      title={dashboardQ.data?.name ?? slug}
      actions={
        <Link
          to={`/dashboards/${encodeURIComponent(slug)}?organizationId=${encodeURIComponent(organizationId)}`}
          className="text-sm font-semibold text-accent-strong hover:underline"
        >
          Open in Dashboards
        </Link>
      }
    >
      {dashboardQ.data !== undefined ? (
        <>
          {tabs.length > 0 ? (
            <nav aria-label="Dashboard tabs" className="mb-3 flex flex-wrap gap-1 border-b border-line pb-2">
              {tabs.map((entry) => (
                <Link
                  key={entry.id}
                  to={siteTabHref(sitePath, entry.key)}
                  aria-current={entry.key === selected?.key ? "page" : undefined}
                  className={`surface-tab px-3 py-1.5 ${TAB_FOCUS_CLASS} ${entry.key === selected?.key ? "surface-tab-selected" : ""}`}
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <DashboardLiveCanvas dashboard={dashboardQ.data} tabKey={selected?.key} />
        </>
      ) : dashboardQ.isError ? (
        <div role="alert" className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
          <p>{apiErrorMessage(dashboardQ.error)}</p>
          <button
            type="button"
            onClick={tryAgain}
            className="surface-button mt-2 border border-critical-line-strong px-3 py-1 text-critical-ink-strong hover:bg-critical-wash-strong"
          >
            Try again
          </button>
        </div>
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Loading dashboard…
        </p>
      )}
    </SectionCard>
  );
}

/** The dashboard's tabs by `sortOrder` — a copy, so the cached DTO is never reordered. */
function sortedTabs(dashboard: DashboardDto): DashboardDto["tabs"] {
  return [...dashboard.tabs].sort((a, b) => a.sortOrder - b.sortOrder);
}
