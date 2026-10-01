import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";

import type { DashboardDto } from "@bms/shared";

import { fetchDashboard } from "../api/dashboards";
import { apiErrorMessage } from "../lib/api-error-message";
import { canAuthorDashboards } from "../lib/admin-access";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { DashboardLiveCanvas } from "../components/dashboards/dashboard-live-canvas";
import { DashboardTabStrip } from "../components/dashboards/dashboard-tab-strip";
import { SiteTabHrefContext } from "../components/widgets/site-widget-parts";
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
    <AppShell user={user} kpiRibbon={<span className="text-ink">{dashboardQ.data?.name ?? "Dashboard"}</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Dashboards"
          title={dashboardQ.data?.name ?? slug}
          subtitle={dashboardQ.data?.description ?? undefined}
          actions={
            dashboardQ.data && canAuthorDashboards(user.role) ? (
              <Link
                to={`/admin/dashboards/${slug}${organizationId ? `?organizationId=${organizationId}` : ""}`}
                className="surface-button px-3 py-1.5"
              >
                Edit dashboard
              </Link>
            ) : undefined
          }
        />

        {dashboardQ.isLoading ? <p className="text-sm text-ink-muted">Loading dashboard…</p> : null}
        {dashboardQ.isError ? (
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {apiErrorMessage(dashboardQ.error as Error)}
          </p>
        ) : null}

        {dashboardQ.data ? <ViewerCanvas dashboard={dashboardQ.data} /> : null}
      </div>
    </AppShell>
  );
}

/** The query parameter that holds the viewer's selected tab key. */
const TAB_PARAM = "tab";

/**
 * `F3.73` (plan D11) — a tabbed dashboard (a site-layout copy reached by "Open in Dashboards")
 * shows the builder's tab strip and renders the selected tab's widgets only; without it every
 * tab's widgets share one grid and the tiles overlap. A dashboard with no tabs renders every
 * widget, as before.
 *
 * `F3.73` critique fix — the selection is in the URL as `?tab=<key>`, beside `organizationId`, so a
 * reload, a shared link and Back keep it. A missing or unknown key opens the first tab by
 * `sortOrder`, and the first load writes nothing. A click pushes a history entry; an arrow-key move
 * replaces it, so Back leaves a run of key presses in one step. The module cards and the
 * critical-systems rows link to their tab here too (`SiteTabHrefContext`).
 *
 * The widget titles are `h3` (`WidgetFrame`), so the canvas carries the `h2` between them and the
 * page's `h1`: the selected tab's label, or "Widgets". It is visually hidden — the strip already
 * shows the label.
 */
function ViewerCanvas({ dashboard }: { dashboard: DashboardDto }) {
  const tabs = useMemo(() => [...dashboard.tabs].sort((a, b) => a.sortOrder - b.sortOrder), [dashboard.tabs]);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKey = searchParams.get(TAB_PARAM);
  const selected = tabs.find((tab) => tab.key === selectedKey) ?? tabs[0];

  function selectTab(key: string, via: "pointer" | "keyboard"): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(TAB_PARAM, key);
        return next;
      },
      { replace: via === "keyboard" },
    );
  }
  const tabHref = useCallback(
    (key: string): string => {
      const next = new URLSearchParams(searchParams);
      next.set(TAB_PARAM, key);
      return `?${next.toString()}`;
    },
    [searchParams],
  );

  if (selected === undefined) {
    return (
      <section>
        <h2 className="sr-only">Widgets</h2>
        <DashboardLiveCanvas dashboard={dashboard} />
      </section>
    );
  }
  return (
    <DashboardTabStrip tabs={tabs} selectedKey={selected.key} onSelect={selectTab}>
      <h2 className="sr-only">{selected.label.trim() || selected.key}</h2>
      <SiteTabHrefContext.Provider value={tabHref}>
        <DashboardLiveCanvas dashboard={dashboard} tabKey={selected.key} />
      </SiteTabHrefContext.Provider>
    </DashboardTabStrip>
  );
}
