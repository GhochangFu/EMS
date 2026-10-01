import type { AccessibleScope, LocationKpiSummary, ResolvedSiteControlRoomViewDto, UserRole } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchResolvedSiteControlRoomView } from "../../api/control-room";
import { fetchLocationKpis } from "../../api/locations";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { GeneratedSiteView } from "../../components/control-room/generated-site-view";
import { MakeSiteLayoutButton } from "../../components/control-room/make-site-layout-button";
import { ScopedDashboardsList } from "../../components/control-room/scoped-dashboards-list";
import { SiteAssetsView } from "../../components/control-room/site-assets-view";
import { SiteDashboardView } from "../../components/control-room/site-dashboard-view";
import { SmocSiteView } from "../../components/control-room/smoc-site-view";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { isMasterDataAdmin } from "../../lib/admin-access";
import { controlRoomCrumbs } from "../../lib/control-room-levels";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import {
  DEFAULT_SMOC_TAB,
  isSmocSite,
  SITE_ASSETS_TAB,
  siteAssetsPath,
  smocTabFromParam,
  type SmocTabKey,
} from "../../lib/smoc-pages";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

type ControlRoomSitePageProps = {
  user: AuthUser;
  /**
   * `F3.72` (plan D1) — overrides the `:locationId` route parameter, so `/`
   * can render the site in place. Omit it on the routed page. The `:tab`
   * segment is still read from the route.
   */
  locationId?: string;
};

const linkClass = "mt-2 inline-block text-sm font-semibold text-accent-strong hover:underline";

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
 *
 * `F3.72` (ADR 0087, plan D4) — the page owns a two-entry strip above the
 * body: **Site view** (the bare path; current for every segment but
 * `assets`, OQ5) and **Assets & RTUs** (`/assets`, `SITE_ASSETS_TAB`). The
 * `assets` segment is exempt from the D5 redirect and renders
 * `SiteAssetsView` for every view kind, once the resolve read has answered —
 * a rejected read still shows the not-available card, so the tab never reads
 * a site outside the scope. The SMOC seven-tab strip stays inside
 * `SmocSiteView` under Site view, and the Site view entry lists the site's
 * dashboards (`ScopedDashboardsList`, D7) under the body.
 *
 * `F3.73` (plan D10) — a `dashboard` view that renders (a slug is set) is exempt from the D5
 * redirect: `SiteDashboardView` owns its `:tab` decision (the dashboard's own tabs) and is
 * handed the raw segment. A `dashboard` row with no slug renders the generated view and still
 * redirects. The `no_site_layout` and `dashboard_removed` notices carry **Make site layout**
 * for `isMasterDataAdmin` roles (`MakeSiteLayoutButton`), beside the notice text, never in it.
 */
export function ControlRoomSitePage({ user, locationId: locationIdProp }: ControlRoomSitePageProps) {
  const params = useParams();
  const locationId = locationIdProp ?? params.locationId ?? "";
  const tabParam = params.tab;
  const onAssetsTab = tabParam === SITE_ASSETS_TAB;
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
  const showsDashboard = siteView.data?.kind === "dashboard" && siteView.data.dashboardSlug !== null;

  if (
    items !== undefined &&
    siteView.data !== undefined &&
    tabParam !== undefined &&
    !onAssetsTab &&
    !showsDashboard &&
    (!showsSmocTabs || tab === null)
  ) {
    return <Navigate to={`/control-room/site/${encodeURIComponent(locationId)}`} replace />;
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-ink">Control Room · site view</span>}
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
              <SiteSectionStrip locationId={site.id} onAssetsTab={onAssetsTab} />
              {siteView.data === undefined ? (
                <p role="status" className="text-sm text-ink-muted">
                  Loading the site view…
                </p>
              ) : onAssetsTab ? (
                <SiteAssetsView locationId={site.id} />
              ) : (
                <>
                  {/* On the SMOC view `tab` is null only for an unknown segment, which redirected above. */}
                  <SiteViewBody
                    view={siteView.data}
                    site={site}
                    scope={scope}
                    tab={tab ?? DEFAULT_SMOC_TAB}
                    tabParam={tabParam}
                    role={user.role}
                  />
                  <ScopedDashboardsList locationId={site.id} organizationId={site.organization.id} />
                </>
              )}
            </>
          ) : (
            <NotAvailableCard />
          )
        ) : locationQ.isError ? (
          <SectionCard title="Control Room unavailable" bodyClassName="p-4">
            <p className="text-sm text-critical-ink">The site list could not be read. Try again later.</p>
          </SectionCard>
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            Loading Control Room…
          </p>
        )}
      </div>
    </AppShell>
  );
}

/**
 * `F3.72` (plan D4, OQ5) — the site's two entries. "Site view" is current for
 * the bare path and every SMOC tab segment; "Assets & RTUs" only at `/assets`.
 */
function SiteSectionStrip({ locationId, onAssetsTab }: { locationId: string; onAssetsTab: boolean }) {
  const entries = [
    { label: "Site view", to: `/control-room/site/${encodeURIComponent(locationId)}`, active: !onAssetsTab },
    { label: "Assets & RTUs", to: siteAssetsPath(locationId), active: onAssetsTab },
  ];
  return (
    <nav aria-label="Site sections" className="flex flex-wrap gap-1 border-b border-line pb-2">
      {entries.map((entry) => (
        <Link
          key={entry.label}
          to={entry.to}
          aria-current={entry.active ? "page" : undefined}
          className={`surface-tab px-3 py-1.5 ${entry.active ? "surface-tab-selected" : ""}`}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}

function NotAvailableCard() {
  return (
    <SectionCard title="Site view unavailable" bodyClassName="p-4">
      <p className="text-sm text-ink-muted">
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
  /** The raw `:tab` segment, for `SiteDashboardView`'s own tab decision (`F3.73` D10). */
  tabParam: string | undefined;
  role: UserRole;
};

/** `F3.73` (plan D10, ruling Q5) — the notices a site layout copy answers. */
const MAKE_SITE_LAYOUT_NOTICES: readonly string[] = ["no_site_layout", "dashboard_removed"];

function SiteViewBody({ view, site, scope, tab, tabParam, role }: SiteViewBodyProps) {
  const notice = siteViewNoticeText(view.notice);
  const offersSiteLayout =
    view.notice !== null && MAKE_SITE_LAYOUT_NOTICES.includes(view.notice) && isMasterDataAdmin(role);

  return (
    <>
      {notice !== null ? (
        <div className="space-y-2 rounded border border-warning-line bg-warning-wash px-4 py-2 text-sm text-warning-ink">
          {/* The testid element holds the notice text only; the action sits beside it. */}
          <div role="status" data-testid="site-view-notice">
            {notice}
          </div>
          {offersSiteLayout ? <MakeSiteLayoutButton locationId={site.id} /> : null}
        </div>
      ) : null}
      {view.kind === "builtin" && isSmocSite(site) ? (
        // Any other site with a `builtin` view falls through to the generated view (L1).
        <SmocSiteView locationId={site.id} tab={tab} scope={scope} />
      ) : view.kind === "dashboard" && view.dashboardSlug !== null ? (
        <SiteDashboardView
          slug={view.dashboardSlug}
          organizationId={site.organization.id}
          locationId={site.id}
          tab={tabParam}
        />
      ) : (
        <GeneratedSiteView locationId={site.id} />
      )}
    </>
  );
}
