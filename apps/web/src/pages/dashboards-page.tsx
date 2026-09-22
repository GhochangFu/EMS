import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { fetchDashboards } from "../api/dashboards";
import { apiErrorMessage } from "../lib/api-error-message";
import { canAuthorDashboards, isMasterDataAdmin } from "../lib/admin-access";
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
 *
 * **The link is gated on `canAuthorDashboards` alone (`F3.63`, ADR 0047 Amendment 6).**
 * `/admin/dashboards` is now wrapped in `DashboardAuthorRoute`, which guards on the same
 * predicate — the composite `canAuthorDashboards(role) && isMasterDataAdmin(role)` this link
 * used to carry existed only because the route guard disagreed with the link's own gate; that
 * disagreement is gone, so the composite went with it.
 */
export function DashboardsPage({ user }: DashboardsPageProps) {
  /**
   * `E4.2` / ADR 0072 decision 1 — `?section=` narrows the list to one dashboard
   * section, which is where the Sustainability entry lands when the section has
   * no instance yet.
   *
   * **The section is part of the query KEY.** TanStack Query caches by key, so a
   * key that ignored it would serve the unfiltered list to the filtered URL and
   * back, and the empty state below — the one that carries the import hint —
   * would never be reached.
   */
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section") ?? undefined;

  const listQ = useQuery({
    queryKey: ["dashboards", "list", { section: section ?? null }],
    queryFn: () => fetchDashboards(undefined, undefined, section),
  });

  const rows = listQ.data?.items ?? [];

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Dashboards</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Monitoring"
          title="Dashboards"
          subtitle={
            section
              ? `${section.charAt(0).toUpperCase()}${section.slice(1)} section`
              : "Configurable widget boards bound to live telemetry"
          }
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
            {/**
             * `E4.2` — a filtered, empty list is a DIFFERENT condition from an
             * empty unfiltered one, and the wording has to say which. "No
             * dashboards are readable in your current scope yet" on
             * `?section=sustainability` reads as a permission problem, and the
             * administrator who can fix it in one click would go looking for a
             * grant instead.
             *
             * The import hint is gated on `isMasterDataAdmin`, because
             * `/admin/dashboard-templates` is: telling an operator to import a
             * template sends them to a screen they cannot open.
             */}
            {section === "sustainability" ? (
              <>
                No Sustainability dashboard yet. Import the stock template from{" "}
                {isMasterDataAdmin(user.role) ? (
                  <Link to="/admin/dashboard-templates" className="font-semibold underline">
                    Dashboard templates
                  </Link>
                ) : (
                  "Dashboard templates"
                )}
                .
              </>
            ) : (
              "No dashboards are readable in your current scope yet."
            )}
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
                      {/* `F3.2` / ADR 0067 decision 7 and Q4 — the asset arm is
                          FIRST, because `dashboards_scope_check` allows at most
                          one of the three and an asset-scoped row is the
                          narrowest audience of the four. Reading it last would
                          label such a row "Organization-wide", the widest, on
                          the one column an operator reads to judge audience —
                          the defect `F3.1d` already fixed once for asset
                          groups. `assetCode` rides the summary DTO (Q4) so the
                          badge needs no second fetch; it is nullable, and the
                          badge then says "Asset" alone rather than printing an
                          empty separator. */}
                      {dashboard.assetId
                        ? dashboard.assetCode
                          ? `Asset · ${dashboard.assetCode}`
                          : "Asset"
                        : dashboard.locationId
                          ? "Location"
                          : dashboard.assetGroupId
                            ? "Asset group"
                            : "Organization-wide"}
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
