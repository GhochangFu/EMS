import type { AccessibleScope, LocationKpiSummary, ResolvedSiteControlRoomViewDto, UserRole } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

import { fetchResolvedSiteControlRoomView } from "../../api/control-room";
import { fetchDashboard } from "../../api/dashboards";
import { fetchLocationKpis } from "../../api/locations";
import { HealthBadActorsCard } from "../../components/asset-health/health-bad-actors-card";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { GeneratedSiteView } from "../../components/control-room/generated-site-view";
import { ReplaceSiteLayoutWizard } from "../../components/control-room/replace-site-layout-wizard";
import { SiteLayoutWizard } from "../../components/control-room/site-layout-wizard";
import { ScopedDashboardsList } from "../../components/control-room/scoped-dashboards-list";
import { SiteAssetsView } from "../../components/control-room/site-assets-view";
import { SiteDashboardView } from "../../components/control-room/site-dashboard-view";
import { StationView } from "../../components/control-room/station-view";
import { SiteTrendsView } from "../../components/control-room/site-trends-view";
import { SmocSiteView } from "../../components/control-room/smoc-site-view";
import { WallFrame } from "../../components/control-room/wall-frame";
import { DegradationTrendCard } from "../../components/degradation/degradation-trend-card";
import { MlFindingsCard } from "../../components/ml/ml-findings-card";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { isMasterDataAdmin } from "../../lib/admin-access";
import { controlRoomCrumbs } from "../../lib/control-room-levels";
import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";
import { stationGroupOf } from "../../lib/location-kpi-groups";
import { siteViewNoticeText, siteViewNoticeTone } from "../../lib/site-view-notice";
import {
  DEFAULT_SMOC_TAB,
  isSmocSite,
  SITE_ASSETS_TAB,
  SITE_TRENDS_TAB,
  siteAssetsPath,
  siteTrendsPath,
  smocTabFromParam,
  type SmocTabKey,
} from "../../lib/smoc-pages";
import { parseWallParams, WALL_DEFAULT_S, wallHref } from "../../lib/wall-mode";
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

/** `E1.9e` — the site body's card shows both kinds. */
const SITE_FINDINGS_KINDS = ["anomalies", "forecasts"] as const;

/**
 * `F4.390` — the site list is read here for the name, the organization, `energyShown` and the
 * crumbs, never for a live figure; admin edits already invalidate the key. So one read a minute,
 * not every 8 s. The other pages on this key draw live card figures from it and keep 8 s.
 */
const SITE_SUMMARY_REFETCH_MS = 60_000;

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
 * for `isMasterDataAdmin` roles (`SiteLayoutWizard`, `F3.86` PR 3d), beside the notice text, never in it.
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decision 8): the same roles see **Replace with this version**
 * above a `dashboard` view that renders (`ReplaceSiteLayoutWizard`); it shows only when its preview
 * read says the view is a template copy that Replace would rebuild.
 *
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8) — **wall mode.** `?wall=1&every=<s>` on a
 * `dashboard` view that renders (the tab stays the route's `:tab` segment, owner ruling OQ2)
 * renders `WallFrame` instead of `AppShell`, with the same `SiteDashboardView` inside (handed
 * `wall`, so it shows no section title and no `Open in Dashboards` link); the frame
 * rotates through the dashboard's tabs by `sortOrder`. Any other view, the assets tab, a site
 * outside the KPI list and a pending read render the normal page (OQ3). The page header's
 * **Wall** link shows on a `dashboard` view only and opens the current tab's wall URL at the
 * default interval. The D5 redirect runs first, so a wall URL with a bad segment still redirects.
 *
 * `F4.302` (ADR 0108 Amendment 4 items 1, 8, 9) — a third entry, **Trends & Energy** at
 * `/trends` (`SITE_TRENDS_TAB`), the `assets` shape: exempt from the D5 redirect, rendered as
 * `SiteTrendsView` for every view kind once the resolve read has answered, never a wall page,
 * and the **Wall** link omits the segment there.
 *
 * `F4.390` — the page re-reads the site list once a minute (`SITE_SUMMARY_REFETCH_MS`), and the
 * read carries the query's abort signal.
 *
 * `E1.9e` (ADR 0135 Amendment 8 decision 13) — the Site view body carries the compact findings
 * card (`MlFindingsCard`, both kinds, scoped to the site and its organization) between the body
 * and the site's dashboards. The wall, the assets tab, the trends tab and a pending read draw none.
 *
 * `E1.8c` (ADR 0050 Amendment 5, owner ruling Q2 (a)) — after that card and before the dashboards:
 * the *Bad actors — advisory* card (`HealthBadActorsCard`), scoped to the site and its organization
 * and with the site's count line inside it (`showCount`; the site page has no donut). Same places
 * as the findings card: never the wall, the assets tab, the trends tab or a pending read.
 *
 * `E1.5b` (ADR 0138 decision 5, plan T2.4) — directly after that card: the *Trending toward a
 * limit — advisory* card (`DegradationTrendCard`), scoped to the site and its organization. The
 * same places: never the wall, the assets tab, the trends tab or a pending read.
 *
 * `F4.240` part b (ADR 0140 decisions 1–4, plan D1, D6, D7) — at a **station** (`stationGroupOf`:
 * a location in the list that holds no asset and heads sites) the body is `StationView`: the
 * totals, the site cards, the station's alarms, the advisory cards and its dashboards, or at
 * `/assets` a list of the sites. The strip reads **Station view** and **Assets & RTUs** only; any
 * other segment redirects to the bare path. No notice, layout wizard, wall or Wall link at a
 * station, and the resolve read still decides access exactly as for a site (decision 6). The list
 * poll stays at 60 s (owner ruling Q2 (a)), though the station draws live figures from it.
 */
export function ControlRoomSitePage({ user, locationId: locationIdProp }: ControlRoomSitePageProps) {
  const params = useParams();
  const location = useLocation();
  const locationId = locationIdProp ?? params.locationId ?? "";
  const tabParam = params.tab;
  const onAssetsTab = tabParam === SITE_ASSETS_TAB;
  const onTrendsTab = tabParam === SITE_TRENDS_TAB;
  const tab = smocTabFromParam(tabParam);
  const scope = useAuthStore((state) => state.scope);
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: ({ signal }) => fetchLocationKpis(signal),
    refetchInterval: SITE_SUMMARY_REFETCH_MS,
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
  const stationGroup = items === undefined ? null : stationGroupOf(items, locationId);
  const atStation = stationGroup !== null;

  const showsSmocTabs = siteView.data?.kind === "builtin" && site !== undefined && isSmocSite(site);
  const dashboardSlug = siteView.data?.kind === "dashboard" ? siteView.data.dashboardSlug : null;
  const showsDashboard = dashboardSlug !== null && !atStation;

  // `F3.77` (plan D8, OQ3) — the wall shows a site's `dashboard` view only, never the assets tab.
  const wall = parseWallParams(location.search);
  const sitePath = `/control-room/site/${encodeURIComponent(locationId)}`;
  const wallSite = wall.on && showsDashboard && !onAssetsTab && !onTrendsTab ? site : undefined;
  // The rotation's tab order. The same key and read as `SiteDashboardView`'s (and the viewer's),
  // so the wall shares that cache entry and adds no request.
  const wallDashboardQ = useQuery({
    queryKey: ["dashboards", "detail", dashboardSlug, wallSite?.organization.id],
    queryFn: () => fetchDashboard(dashboardSlug as string, wallSite?.organization.id as string),
    enabled: wallSite !== undefined,
  });

  if (
    items !== undefined &&
    siteView.data !== undefined &&
    tabParam !== undefined &&
    !onAssetsTab &&
    (atStation || (!onTrendsTab && !showsDashboard && (!showsSmocTabs || tab === null)))
  ) {
    return <Navigate to={sitePath} replace />;
  }

  if (wallSite !== undefined && dashboardSlug !== null) {
    const tabKeys = [...(wallDashboardQ.data?.tabs ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => entry.key);
    return (
      <WallFrame
        siteName={wallSite.name}
        sitePath={sitePath}
        tabKeys={tabKeys}
        currentKey={tabParam}
        everyS={wall.everyS}
      >
        <SiteDashboardView
          slug={dashboardSlug}
          organizationId={wallSite.organization.id}
          locationId={wallSite.id}
          tab={tabParam}
          wall
          energyShown={wallSite.energyShown}
        />
      </WallFrame>
    );
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
                actions={
                  showsDashboard ? (
                    <Link
                      to={wallHref(sitePath, onAssetsTab || onTrendsTab ? undefined : tabParam, WALL_DEFAULT_S)}
                      className={`surface-button px-3 py-1.5 text-sm font-semibold text-accent-strong ${FOCUS_OUTLINE_CLASS}`}
                    >
                      Wall
                    </Link>
                  ) : undefined
                }
              />
              <SiteSectionStrip
                locationId={site.id}
                onAssetsTab={onAssetsTab}
                onTrendsTab={onTrendsTab}
                energyShown={site.energyShown}
                station={atStation}
              />
              {siteView.data === undefined ? (
                <p role="status" className="text-sm text-ink-muted">
                  Loading the site view…
                </p>
              ) : stationGroup !== null ? (
                <StationView station={site} group={stationGroup} section={onAssetsTab ? "assets" : "view"} />
              ) : onAssetsTab ? (
                <SiteAssetsView locationId={site.id} siteName={site.name} energyShown={site.energyShown} />
              ) : onTrendsTab ? (
                <SiteTrendsView locationId={site.id} energyShown={site.energyShown} />
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
                  {/* `E1.9e` (ADR 0135 Amendment 8 decision 13) — the body only; the wall returned above. */}
                  <MlFindingsCard
                    kinds={SITE_FINDINGS_KINDS}
                    scope={{ organizationId: site.organization.id, locationId: site.id }}
                    compact
                  />
                  {/* `E1.8c` (Q2 (a)) — the body only, with the site's count line inside the card. */}
                  <HealthBadActorsCard organizationId={site.organization.id} locationId={site.id} showCount />
                  {/* `E1.5b` (ADR 0138 decision 5) — the body only; never on the wall. */}
                  <DegradationTrendCard organizationId={site.organization.id} locationId={site.id} />
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
 * `F3.72` (plan D4, OQ5) — the site's entries. "Site view" is current for
 * the bare path and every SMOC tab segment; "Assets & RTUs" only at `/assets`;
 * "Trends & Energy" (`F4.302`, ADR 0108 Amendment 4 item 1) only at `/trends`. `F4.364` (ADR
 * 0133 Amendment 1): when the site's energy is not shown, that entry is named "Trends" (same path).
 * `F4.240` part b (plan D7): at a station the first entry reads "Station view" and there is no
 * third entry until PR 2.
 */
function SiteSectionStrip({
  locationId,
  onAssetsTab,
  onTrendsTab,
  energyShown,
  station,
}: {
  locationId: string;
  onAssetsTab: boolean;
  onTrendsTab: boolean;
  energyShown: boolean;
  station: boolean;
}) {
  const entries = [
    {
      label: station ? "Station view" : "Site view",
      to: `/control-room/site/${encodeURIComponent(locationId)}`,
      active: !onAssetsTab && !onTrendsTab,
    },
    { label: "Assets & RTUs", to: siteAssetsPath(locationId), active: onAssetsTab },
    ...(station
      ? []
      : [{ label: energyShown ? "Trends & Energy" : "Trends", to: siteTrendsPath(locationId), active: onTrendsTab }]),
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
  const offersReplace = view.kind === "dashboard" && view.dashboardSlug !== null && isMasterDataAdmin(role);

  return (
    <>
      {notice !== null ? (
        <div
          data-testid="site-view-notice-box"
          className={`space-y-2 rounded border px-4 py-2 text-sm ${
            view.notice !== null && siteViewNoticeTone(view.notice) === "info"
              ? "border-info-line bg-info-wash text-info-ink"
              : "border-warning-line bg-warning-wash text-warning-ink"
          }`}
        >
          {/* The testid element holds the notice text only; the action sits beside it. */}
          <div role="status" data-testid="site-view-notice" className="max-w-prose">
            {notice}
          </div>
          {offersSiteLayout ? <SiteLayoutWizard locationId={site.id} siteName={site.name} /> : null}
        </div>
      ) : null}
      {offersReplace ? <ReplaceSiteLayoutWizard locationId={site.id} siteName={site.name} /> : null}
      {view.kind === "builtin" && isSmocSite(site) ? (
        // Any other site with a `builtin` view falls through to the generated view (L1).
        <SmocSiteView locationId={site.id} tab={tab} scope={scope} />
      ) : view.kind === "dashboard" && view.dashboardSlug !== null ? (
        <SiteDashboardView
          slug={view.dashboardSlug}
          organizationId={site.organization.id}
          locationId={site.id}
          tab={tabParam}
          role={role}
          siteName={site.name}
          energyShown={site.energyShown}
        />
      ) : (
        <GeneratedSiteView locationId={site.id} energyShown={site.energyShown} />
      )}
    </>
  );
}
