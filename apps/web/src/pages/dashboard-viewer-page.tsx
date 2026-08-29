import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";

import type { DashboardWidgetDto } from "@bms/shared";

import { fetchDashboard } from "../api/dashboards";
import { apiErrorMessage } from "../lib/api-error-message";
import { canAuthorDashboards, isMasterDataAdmin } from "../lib/admin-access";
import { useDashboardTelemetry } from "../hooks/use-dashboard-telemetry";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { DashboardCanvas, type CanvasTile } from "../components/dashboards/dashboard-canvas";
import { DashboardWidgetLive } from "../components/dashboards/dashboard-widget-live";
import type { AuthUser } from "../stores/auth-store";

type DashboardViewerPageProps = {
  user: AuthUser;
};

type WidgetTile = CanvasTile & { widget: DashboardWidgetDto };

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
 * **The "Edit dashboard" link is gated on `canAuthorDashboards(role) && isMasterDataAdmin(role)`
 * (review finding, HIGH).** `canAuthorDashboards` alone admits `asset_group_admin`, but the
 * target route is wrapped in `<AdminRoute>`, which guards on `isMasterDataAdmin` and excludes
 * that role — the un-narrowed gate handed it a link into a silent redirect. Mirrors
 * `dashboards-page.tsx`'s own fix; `canAuthorDashboards`'s membership is unchanged.
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

  const { latestByRef, historyByRef } = useDashboardTelemetry(dashboardQ.data);
  // Read fresh on every render, so the periodic re-render `useDashboardTelemetry`'s own
  // `staleTick` drives (review finding, HIGH) actually advances the clock `widgetDataFor` ages
  // readings against — without this the tick would fire but every widget would keep comparing
  // against the timestamp of whatever render last touched a socket message.
  const now = Date.now();

  const tiles: WidgetTile[] = (dashboardQ.data?.widgets ?? []).map((widget) => ({
    key: widget.id,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    widget,
  }));

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">{dashboardQ.data?.name ?? "Dashboard"}</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Dashboards"
          title={dashboardQ.data?.name ?? slug}
          subtitle={dashboardQ.data?.description ?? undefined}
          actions={
            dashboardQ.data && canAuthorDashboards(user.role) && isMasterDataAdmin(user.role) ? (
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

        {dashboardQ.data && tiles.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
            This dashboard has no widgets yet.
          </p>
        ) : null}

        {tiles.length > 0 ? (
          <DashboardCanvas
            tiles={tiles}
            renderTile={(tile) => (
              <DashboardWidgetLive
                widget={tile.widget}
                latestByRef={latestByRef}
                historyByRef={historyByRef}
                now={now}
              />
            )}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
