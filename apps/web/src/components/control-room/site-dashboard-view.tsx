import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchDashboard } from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import { DashboardLiveCanvas } from "../dashboards/dashboard-live-canvas";
import { SectionCard } from "../section-card";

type SiteDashboardViewProps = {
  slug: string;
  organizationId: string;
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
 */
export function SiteDashboardView({ slug, organizationId }: SiteDashboardViewProps) {
  const queryClient = useQueryClient();
  const dashboardQ = useQuery({
    queryKey: ["dashboards", "detail", slug, organizationId],
    queryFn: () => fetchDashboard(slug, organizationId),
  });

  const tryAgain = () => {
    void queryClient.invalidateQueries({ queryKey: [...SITE_VIEW_RESOLVE_PREFIX] });
    void dashboardQ.refetch();
  };

  return (
    <SectionCard
      title={dashboardQ.data?.name ?? slug}
      actions={
        <Link
          to={`/dashboards/${encodeURIComponent(slug)}?organizationId=${encodeURIComponent(organizationId)}`}
          className="text-sm font-semibold text-bms-green hover:underline"
        >
          Open in Dashboards
        </Link>
      }
    >
      {dashboardQ.data !== undefined ? (
        <DashboardLiveCanvas dashboard={dashboardQ.data} />
      ) : dashboardQ.isError ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{apiErrorMessage(dashboardQ.error)}</p>
          <button
            type="button"
            onClick={tryAgain}
            className="mt-2 rounded border border-red-300 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : (
        <p role="status" className="text-sm text-bms-muted">
          Loading dashboard…
        </p>
      )}
    </SectionCard>
  );
}
