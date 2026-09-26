import type { AccessibleScope, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchResolvedSiteControlRoomView } from "../../api/control-room";
import { fetchLocationKpis } from "../../api/locations";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { GeneratedSiteView } from "../../components/control-room/generated-site-view";
import { SiteDashboardView } from "../../components/control-room/site-dashboard-view";
import { SmocSiteView } from "../../components/control-room/smoc-site-view";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { controlRoomCrumbs } from "../../lib/control-room-levels";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import { DEFAULT_SMOC_TAB, isSmocSite, smocTabFromParam, type SmocTabKey } from "../../lib/smoc-pages";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

type ControlRoomSitePageProps = {
  user: AuthUser;
};

const linkClass = "mt-2 inline-block text-sm font-semibold text-bms-green hover:underline";

/**
 * `F3.66` (ADR 0076 decisions 2 and 5) — `/control-room/site/:locationId`, the
 * site view host. The name, the organization and the crumbs come from the KPI
 * list; the body comes from `F3.67`'s resolve read, one per `kind`: the
 * generated interim (D7), the SMOC tabs (`F3.70`, `SmocSiteView`: the strip
 * and the chosen tab's content under the per-area rule), or the configured
 * dashboard rendered inline (`SiteDashboardView`, `F3.69`). A resolve read that
 * rejects before it ever answered — the API answers 404 for a site outside
 * the scope — shows the not-available card and never an interim body (D6).
 * The page decides from the data, not the status: a background refetch that
 * fails after an answer (a window refocus during an API restart) sets
 * `isError` with `data` kept, and keeps the body. The `F4.156` interim route
 * guard is removed as of `F3.70` U5b; the seven `/cr-*` routes now redirect
 * through `SmocLegacyRedirect`.
 *
 * `F3.70` D5 (OQ5): the optional `:tab` segment names a SMOC tab. Once both
 * reads have data, a tab segment on a site that does not show the SMOC tabs,
 * or a tab that is not one of the seven, redirects to the bare site path,
 * which renders the site's current view. The decision is made here, before
 * the body, so no body ever renders at the tab URL.
 *
 * The SMOC tabs show only for a `builtin` view on the SMOC site itself —
 * `RSMOC-WC` in `ESKOM` (`isSmocSite`; security review L1). A `builtin`
 * view on any other site renders the generated view, as `generated` does,
 * and its tab URLs redirect like a non-`builtin` site's. A site outside the
 * KPI list does not show the tabs either; its tab URL redirects to the bare
 * path, which shows the not-available card.
 */
export function ControlRoomSitePage({ user }: ControlRoomSitePageProps) {
  const { locationId = "", tab: tabParam } = useParams();
  const tab = smocTabFromParam(tabParam);
  const scope = useAuthStore((state) => state.scope);
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
    refetchInterval: 8000,
  });
  const siteView = useQuery({
    queryKey: ["control-room", "site-view", locationId],
    queryFn: () => fetchResolvedSiteControlRoomView(locationId),
    enabled: locationId !== "",
    // A 404 is the answer for a site outside the scope, not a transient
    // failure: show the not-available card at once rather than after retries.
    retry: false,
  });

  const items = locationQ.data?.items;
  const site = items?.find((item) => item.id === locationId);

  const showsSmocTabs = siteView.data?.kind === "builtin" && site !== undefined && isSmocSite(site);

  if (
    items !== undefined &&
    siteView.data !== undefined &&
    tabParam !== undefined &&
    (!showsSmocTabs || tab === null)
  ) {
    return <Navigate to={`/control-room/site/${encodeURIComponent(locationId)}`} replace />;
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">Control Room · site view</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        {items !== undefined ? (
          site !== undefined && !(siteView.data === undefined && siteView.isError) ? (
            <>
              <ControlRoomBreadcrumb crumbs={controlRoomCrumbs(items, { locationId })} />
              <PageHeader
                eyebrow="Control Room"
                title={site.name}
                subtitle={`${site.organization.name} · ${site.organization.code}`}
              />
              {siteView.data !== undefined ? (
                // `tab` is null only for an unknown segment, which redirected above.
                <SiteViewBody view={siteView.data} site={site} scope={scope} tab={tab ?? DEFAULT_SMOC_TAB} />
              ) : (
                <p role="status" className="text-sm text-bms-muted">
                  Loading the site view…
                </p>
              )}
            </>
          ) : (
            <NotAvailableCard />
          )
        ) : locationQ.isError ? (
          <SectionCard title="Control Room unavailable" bodyClassName="p-4">
            <p className="text-sm text-red-700">The site list could not be read. Try again later.</p>
          </SectionCard>
        ) : (
          <p role="status" className="text-sm text-bms-muted">
            Loading Control Room…
          </p>
        )}
      </div>
    </AppShell>
  );
}

function NotAvailableCard() {
  return (
    <SectionCard title="Site view unavailable" bodyClassName="p-4">
      <p className="text-sm text-bms-muted">
        This site is not available in your access scope.
      </p>
      <Link to="/control-room" className={linkClass}>
        Back to the Control Room
      </Link>
    </SectionCard>
  );
}

type SiteViewBodyProps = {
  view: ResolvedSiteControlRoomViewDto;
  site: LocationKpiSummary;
  scope: AccessibleScope | null;
  tab: SmocTabKey;
};

function SiteViewBody({ view, site, scope, tab }: SiteViewBodyProps) {
  const notice = siteViewNoticeText(view.notice);

  return (
    <>
      {notice !== null ? (
        <div
          role="status"
          data-testid="site-view-notice"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          {notice}
        </div>
      ) : null}
      {view.kind === "builtin" && isSmocSite(site) ? (
        // Any other site with a `builtin` view falls through to the generated view (L1).
        <SmocSiteView locationId={site.id} tab={tab} scope={scope} />
      ) : view.kind === "dashboard" && view.dashboardSlug !== null ? (
        <SiteDashboardView slug={view.dashboardSlug} organizationId={site.organization.id} />
      ) : (
        <GeneratedSiteView locationId={site.id} />
      )}
    </>
  );
}
