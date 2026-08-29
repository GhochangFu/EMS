import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchDashboards } from "../api/dashboards";
import { apiErrorMessage } from "../lib/api-error-message";
import { canAuthorDashboards } from "../lib/admin-access";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import type { AuthUser } from "../stores/auth-store";

type DashboardsPageProps = {
  user: AuthUser;
};

/**
 * `F3.1d` Unit 6 — the read-only dashboard list.
 *
 * Renders whatever `GET /dashboards` returns and does **not** re-derive read
 * visibility client-side — ADR 0047 Amendment 4: read authorization stays the
 * API's. The one authoring affordance on this page is the "Manage
 * dashboards" link, gated on `canAuthorDashboards`; every mutating control
 * (create/edit/duplicate/delete) lives on the builder this links to, never
 * here (plan §6.1).
 */
export function DashboardsPage({ user }: DashboardsPageProps) {
  const listQ = useQuery({
    queryKey: ["dashboards", "list"],
    queryFn: () => fetchDashboards(),
  });

  const rows = listQ.data?.items ?? [];

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Dashboards</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Monitoring"
          title="Dashboards"
          subtitle="Configurable widget boards bound to live telemetry"
          actions={
            canAuthorDashboards(user.role) ? (
              <Link
                to="/admin/dashboards"
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-ink hover:bg-gray-50"
              >
                Manage dashboards
              </Link>
            ) : undefined
          }
        />

        {listQ.isLoading ? <p className="text-sm text-bms-muted">Loading dashboards…</p> : null}
        {listQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {apiErrorMessage(listQ.error as Error)}
          </p>
        ) : null}

        {!listQ.isLoading && !listQ.isError && rows.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
            No dashboards are readable in your current scope yet.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <SectionCard bodyClassName="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Widgets</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((dashboard) => (
                  <tr key={dashboard.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-medium">{dashboard.name}</td>
                    <td className="px-3 py-2 text-xs text-bms-muted">
                      {dashboard.locationId ? "Location" : "Organization-wide"}
                    </td>
                    <td className="px-3 py-2 text-xs">{dashboard.widgetCount}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/dashboards/${dashboard.slug}?organizationId=${dashboard.organizationId}`}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-semibold text-bms-ink hover:bg-gray-50"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
