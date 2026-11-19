import type { LocationKpiSummary } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchLocationKpis } from "../../api/locations";
import { HealthBadActorsCard } from "../../components/asset-health/health-bad-actors-card";
import { HealthSummarySection } from "../../components/asset-health/health-summary-section";
import { ActiveAlarmsRail } from "../../components/control-room/active-alarms-rail";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { OrganizationKpiStrip, OrganizationStripCharts } from "../../components/control-room/organization-kpi-strip";
import { OrganizationLoadTrend } from "../../components/control-room/organization-load-trend";
import { OrganizationSiteMap } from "../../components/control-room/organization-site-map";
import { ScopedDashboardsList } from "../../components/control-room/scoped-dashboards-list";
import { SiteCardGroups } from "../../components/control-room/site-card-groups";
import { DegradationTrendCard } from "../../components/degradation/degradation-trend-card";
import { MlFindingsCard } from "../../components/ml/ml-findings-card";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import {
  controlRoomCrumbs,
  organizationCards,
  organizationEntryTarget,
} from "../../lib/control-room-levels";
import {
  anyEnergyShown,
  groupByOrganization,
  groupSitesByParent,
  splitGroupsByLive,
  type GroupedSites,
} from "../../lib/location-kpi-groups";
import { organizationNodes } from "../../lib/map-site";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useBoard } from "../../lib/board-spans";

type ControlRoomOrganizationPageProps = {
  user: AuthUser;
  /**
   * `F3.72` (plan D1) — overrides the `:organizationId` route parameter, so
   * `/` can render this level in place. Omit it on the routed page.
   */
  organizationId?: string;
};

/**
 * `F3.66` (ADR 0076 decision 2) — `/control-room/org/:organizationId`, the
 * organization overview: a card per readable site of that organization (the
 * `/` card, re-linked to the site level, plan D4) and `ActiveAlarmsRail` over
 * the organization's readable assets. The rail reads by `organizationId`
 * (step-5 fix): the API narrows to that organization's assets, intersected
 * with the caller's readable set, so the page sends no asset ids and makes no
 * asset read. An id list is capped at 200 by the API, which left an
 * organization with more readable assets on "Alarms unavailable" for good.
 * An organization with one readable site skips to it; an id outside the KPI
 * list shows the empty card and no other organization's sites. Nothing is
 * decided while the read is pending (D1).
 *
 * `F3.72` (plan D3) — under the site grid: Asset health, the load trend and the
 * library dashboards, each read by `organizationId`. They render only with the
 * overview, so the empty card and the pending read send none of those reads.
 *
 * `F3.79` — above the site grid: the site map, this organization's pins only. It is keyed by
 * `organizationId`, so a move to another organization mounts a new map that fits its sites.
 *
 * `F4.259` — the site cards sit in two groups, live first; a group with no site is not rendered.
 *
 * `F4.317` (ADR 0112) — under the header: the 14-tile KPI strip from the organization template
 * (`OrganizationKpiStrip`), which replaced `F4.259`'s two-tile live/not-live strip here. The strip
 * is its own read, so a failed one leaves the cards and the rail standing.
 *
 * `E1.9e` (ADR 0135 Amendment 8 decision 13) — the compact findings card (`MlFindingsCard`), both
 * kinds, scoped to the organization. Like the other panels it renders only with the overview.
 * `E1.9g` (ADR 0135 Amendment 10 Q5) moved it directly above Asset health, after the cost chart.
 *
 * `E1.8c` (ADR 0050 Amendment 5) — directly after Asset health and before the load trend: the
 * *Bad actors — advisory* card (`HealthBadActorsCard`), scoped to the organization, without its
 * count line (the organization's sits under the donut).
 *
 * `E1.5b` (ADR 0138 decision 5, plan T2.4) — directly after it: the *Trending toward a limit —
 * advisory* card (`DegradationTrendCard`), scoped to the organization, keyed so each organization
 * mounts its own.
 *
 * `F4.240` (ADR 0139 decisions 13–16, plan D11–D12) — the cards are grouped under their parent
 * (`SiteCardGroups`); an organization with no tree renders as before. A header click sets the
 * site map's parent filter, which this page now owns (`mapRootId`), and scrolls the map into view;
 * a click on the pressed header clears it.
 * The overview is keyed by organization, so the filter does not survive a move to another one.
 */
export function ControlRoomOrganizationPage({
  user,
  organizationId: organizationIdProp,
}: ControlRoomOrganizationPageProps) {
  const params = useParams();
  const organizationId = organizationIdProp ?? params.organizationId ?? "";
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
    refetchInterval: 8000,
  });
  const items = locationQ.data?.items;
  const target = items !== undefined ? organizationEntryTarget(items, organizationId) : null;

  if (target?.level === "site") {
    return <Navigate to={`/control-room/site/${target.locationId}`} replace />;
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-ink">Control Room · sites and active alarms</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        {items !== undefined && target !== null ? (
          target.level === "empty" ? (
            <SectionCard title="No sites for this organization in your access scope" bodyClassName="p-4">
              <p className="text-sm text-ink-muted">
                This organization holds no site you can read.
              </p>
              <Link
                to="/control-room"
                className="mt-2 inline-block text-sm font-semibold text-accent-strong hover:underline"
              >
                Back to the Control Room
              </Link>
            </SectionCard>
          ) : (
            <OrganizationOverview
              key={organizationId}
              items={items}
              organizationId={organizationId}
              syncedAt={locationQ.dataUpdatedAt}
            />
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

/** `E1.9e` — the control room's card shows both kinds. */
const ORGANIZATION_FINDINGS_KINDS = ["anomalies", "forecasts"] as const;

type OrganizationOverviewProps = {
  items: readonly LocationKpiSummary[];
  organizationId: string;
  /** `F4.260` — when the site read last landed; the map re-reads on it. */
  syncedAt: number;
};

function OrganizationOverview({ items, organizationId, syncedAt }: OrganizationOverviewProps) {
  // `F2.10` (ADR 0098 B12) — the site map's parent filter offers this organization's nodes.
  const scopeLocations = useAuthStore((s) => s.scope)?.locations ?? [];
  // F4.341 PR 11: the fixed arrangement a design system gives this page (`lib/board-spans.ts`).
  const board = useBoard("organization-overview", "xl:grid-cols-[minmax(0,1fr)_320px]");
  // Sorted by name, as `/` sorts a section (`groupByOrganization`).
  const sites = groupByOrganization(
    items.filter((item) => item.organization.id === organizationId),
  )[0].locations;
  const card = organizationCards(sites)[0];
  // `F4.259` — each group keeps the name order. `F4.240` (D11) — Live and Not live hold the
  // parent groups, and their headings count sites, as the organization card's chips do.
  const { live, notLive } = splitGroupsByLive(groupSitesByParent(sites));
  // `F4.240` (D12) — the map's parent filter; a header click sets it, and a click on the pressed
  // header clears it (the map's own control may hold no option for that parent yet).
  const [mapRootId, setMapRootId] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const selectParent = (parentId: string) => {
    if (mapRootId === parentId) {
      setMapRootId(null);
      return;
    }
    setMapRootId(parentId);
    // jsdom has no `scrollIntoView`, hence `?.`.
    mapRef.current?.scrollIntoView?.({ block: "nearest" });
  };
  const groupProps = { onSelectParent: selectParent, selectedParentId: mapRootId };
  // `F4.375` (ADR 0133 Amendment 2 rulings Q5, Q7) — no site of this organization in scope shows
  // energy: the strip drops its kW-only tiles and the load card is not drawn.
  const energyShown = anyEnergyShown(sites);

  return (
    <>
      <ControlRoomBreadcrumb crumbs={controlRoomCrumbs(items, { organizationId })} />
      <PageHeader
        eyebrow="Control Room"
        title={card.organization.name}
        subtitle={`${card.organization.code} · ${card.siteCount} sites · ${card.openAlarms} alarms`}
      />
      <OrganizationKpiStrip key={`kpi-strip-${organizationId}`} organizationId={organizationId} energyShown={energyShown} />
      <div ref={mapRef}>
        <OrganizationSiteMap
          key={organizationId}
          organizationId={organizationId}
          nodes={organizationNodes(scopeLocations, items, organizationId)}
          syncedAt={syncedAt}
          rootId={mapRootId}
          onRootChange={setMapRootId}
        />
      </div>
      <div className={`grid gap-4 ${board.grid}`}>
        <div data-testid="control-room-sites" data-tile="sites" className={`min-w-0 space-y-4 ${board.span("sites")}`}>
          {hasCards(live) ? (
            <SiteGroup
              testId="control-room-sites-live"
              title="Live sites"
              live
              count={card.sitesOnline}
              grouped={live}
              {...groupProps}
            />
          ) : null}
          {hasCards(notLive) ? (
            <SiteGroup
              testId="control-room-sites-not-live"
              title="Not live"
              live={false}
              count={card.siteCount - card.sitesOnline}
              grouped={notLive}
              {...groupProps}
            />
          ) : null}
        </div>
        <div data-tile="active-alarms" className={`min-w-0 ${board.span("active-alarms")}`}>
          <ActiveAlarmsRail organizationId={organizationId} />
        </div>
      </div>
      {/* `F4.337` — the strip's daily cost chart, after the alarms; since `E1.9g` the findings card follows it. */}
      <OrganizationStripCharts key={`strip-charts-${organizationId}`} organizationId={organizationId} />
      {/* `E1.9e` / `E1.9g` (ADR 0135 Amendment 10 Q5) — the compact findings card, directly above Asset health. */}
      <MlFindingsCard kinds={ORGANIZATION_FINDINGS_KINDS} scope={{ organizationId }} compact />
      <HealthSummarySection organizationId={organizationId} />
      {/* `E1.8c` (ADR 0050 Amendment 5) — directly after Asset health; no count line, the donut has it. */}
      <HealthBadActorsCard key={`bad-actors-${organizationId}`} organizationId={organizationId} />
      {/* `E1.5b` (ADR 0138 decision 5) — directly after Bad actors. */}
      <DegradationTrendCard key={`degradation-${organizationId}`} organizationId={organizationId} />
      {energyShown ? <OrganizationLoadTrend organizationId={organizationId} /> : null}
      <ScopedDashboardsList organizationId={organizationId} />
    </>
  );
}

function hasCards(grouped: GroupedSites): boolean {
  return grouped.loose.length > 0 || grouped.groups.length > 0;
}

type SiteGroupProps = {
  testId: string;
  title: string;
  live: boolean;
  /** `F4.240` (D11) — the organization's live or not-live sites, the organization card's chip. */
  count: number;
  grouped: GroupedSites;
  onSelectParent: (parentId: string) => void;
  selectedParentId: string | null;
};

/**
 * `F4.259` — one group of site cards under a heading that carries its count. `F4.240` — the cards
 * sit under their parent headers; the count is of sites, so a group's not-live card under Live is
 * explained by its header's "x of y sites live".
 */
function SiteGroup({ testId, title, live, count, grouped, onSelectParent, selectedParentId }: SiteGroupProps) {
  return (
    <section data-testid={testId} className="space-y-2">
      <h2
        className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${
          live ? "text-ok-ink" : "text-warning-ink"
        }`}
      >
        <span
          aria-hidden
          className={`inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-ok" : "border-2 border-warning"}`}
        />
        {`${title} (${count})`}
      </h2>
      <SiteCardGroups grouped={grouped} onSelectParent={onSelectParent} selectedParentId={selectedParentId} />
    </section>
  );
}
