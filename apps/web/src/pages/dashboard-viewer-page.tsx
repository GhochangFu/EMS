import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { fetchDashboard } from "../api/dashboards";
import { apiErrorMessage } from "../lib/api-error-message";
import { canAuthorDashboards } from "../lib/admin-access";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { DashboardLiveCanvas } from "../components/dashboards/dashboard-live-canvas";
import type { AuthUser } from "../stores/auth-store";

type DashboardViewerPageProps = {
  user: AuthUser;
};

/**
 * `F3.1d` Unit 6 — the read-only dashboard detail.
 *
 * **Not `dashboard-view-page.tsx`.** `apps/web/src/components/asset-templates/dashboard-view-editor.tsx`
 * is `F3.1e`'s unrelated template-content editor; two files one word apart is
 * how the wrong one gets imported (plan §6.1).
 *
 * `?organizationId=` disambiguates a slug that matches more than one
 * organization's dashboard on the fleet pool (D5). On that 400 the API's own
 * message is rendered inline, unmodified.
 *
 * **The "Edit dashboard" link is gated on `canAuthorDashboards` alone (`F3.63`, ADR 0047
 * Amendment 6).** The target route is now wrapped in `DashboardAuthorRoute`, which guards on the
 * same predicate, so the `&& isMasterDataAdmin(role)` this link used to carry — needed only
 * because the route guard disagreed with the link's own gate — is gone. Mirrors
 * `dashboards-page.tsx`'s own change.
 */
export function DashboardViewerPage({ user }: DashboardViewerPageProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const organizationId = searchParams.get("organizationId") ?? undefined;

  const dashboardQ = useQuery({
    queryKey: ["dashboards", "detail", slug, organizationId],
    queryFn: () => fetchDashboard(slug, organizationId),
    enabled: slug !== "",
  });

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">{dashboardQ.data?.name ?? "Dashboard"}</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Dashboards"
          title={dashboardQ.data?.name ?? slug}
          subtitle={dashboardQ.data?.description ?? undefined}
          actions={
            dashboardQ.data && canAuthorDashboards(user.role) ? (
              <Link
                to={`/admin/dashboards/${slug}${organizationId ? `?organizationId=${organizationId}` : ""}`}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-ink hover:bg-gray-50"
              >
                Edit dashboard
              </Link>
            ) : undefined
          }
        />

        {dashboardQ.isLoading ? <p className="text-sm text-bms-muted">Loading dashboard…</p> : null}
        {dashboardQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {apiErrorMessage(dashboardQ.error as Error)}
          </p>
        ) : null}

        {dashboardQ.data ? <DashboardLiveCanvas dashboard={dashboardQ.data} /> : null}
      </div>
    </AppShell>
  );
}
