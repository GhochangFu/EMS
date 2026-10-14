import type { LocationKpiSummary } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchLocationKpis } from "../../api/locations";
import { HealthSummarySection } from "../../components/asset-health/health-summary-section";
import { ActiveAlarmsRail } from "../../components/control-room/active-alarms-rail";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { OrganizationLoadTrend } from "../../components/control-room/organization-load-trend";
import { OrganizationSiteMap } from "../../components/control-room/organization-site-map";
import { ScopedDashboardsList } from "../../components/control-room/scoped-dashboards-list";
import { LocationKpiCard } from "../../components/location-kpi-card";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import {
  controlRoomCrumbs,
  organizationCards,
  organizationEntryTarget,
} from "../../lib/control-room-levels";
import { groupByOrganization, splitByLiveTelemetry } from "../../lib/location-kpi-groups";
import { organizationNodes } from "../../lib/map-site";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

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
 * `F4.259` — under the header: a strip with the live and not-live site counts. The site cards
 * sit in two groups, live first; a group with no site is not rendered.
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
            <OrganizationOverview items={items} organizationId={organizationId} syncedAt={locationQ.dataUpdatedAt} />
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

type OrganizationOverviewProps = {
  items: readonly LocationKpiSummary[];
  organizationId: string;
  /** `F4.260` — when the site read last landed; the map re-reads on it. */
  syncedAt: number;
};

function OrganizationOverview({ items, organizationId, syncedAt }: OrganizationOverviewProps) {
  // `F2.10` (ADR 0098 B12) — the site map's parent filter offers this organization's nodes.
  const scopeLocations = useAuthStore((s) => s.scope)?.locations ?? [];
  // Sorted by name, as `/` sorts a section (`groupByOrganization`).
  const sites = groupByOrganization(
    items.filter((item) => item.organization.id === organizationId),
  )[0].locations;
  const card = organizationCards(sites)[0];
  // `F4.259` — each group keeps the name order.
  const { live, notLive } = splitByLiveTelemetry(sites);

  return (
    <>
      <ControlRoomBreadcrumb crumbs={controlRoomCrumbs(items, { organizationId })} />
      <PageHeader
        eyebrow="Control Room"
        title={card.organization.name}
        subtitle={`${card.organization.code} · ${card.siteCount} sites · ${card.openAlarms} alarms`}
      />
      <LiveStatusStrip liveCount={live.length} notLiveCount={notLive.length} />
      <OrganizationSiteMap
        key={organizationId}
        organizationId={organizationId}
        nodes={organizationNodes(scopeLocations, items, organizationId)}
        syncedAt={syncedAt}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div data-testid="control-room-sites" className="min-w-0 space-y-4">
          {live.length > 0 ? (
            <SiteGroup testId="control-room-sites-live" title="Live sites" live sites={live} />
          ) : null}
          {notLive.length > 0 ? (
            <SiteGroup testId="control-room-sites-not-live" title="Not live" live={false} sites={notLive} />
          ) : null}
        </div>
        <ActiveAlarmsRail organizationId={organizationId} />
      </div>
      <HealthSummarySection organizationId={organizationId} />
      <OrganizationLoadTrend organizationId={organizationId} />
      <ScopedDashboardsList organizationId={organizationId} />
    </>
  );
}

type LiveStatusStripProps = {
  liveCount: number;
  notLiveCount: number;
};

/**
 * `F4.259` — the organization's live and not-live site counts, large, under the header. They
 * replace the subtitle's small "N online". The not-live percent is the remainder of the live
 * one, so the two always add up to 100.
 */
function LiveStatusStrip({ liveCount, notLiveCount }: LiveStatusStripProps) {
  const total = liveCount + notLiveCount;
  const livePercent = total > 0 ? Math.round((liveCount / total) * 100) : 0;

  return (
    <div data-testid="live-status-strip" className="grid gap-3 sm:grid-cols-2">
      <StatusTile
        live
        label="Live sites"
        count={liveCount}
        countTestId="live-site-count"
        detail={`of ${total} · ${livePercent}% reporting fresh telemetry`}
      />
      <StatusTile
        live={false}
        label="Not live"
        count={notLiveCount}
        countTestId="not-live-site-count"
        detail={`of ${total} · ${total > 0 ? 100 - livePercent : 0}% with no fresh telemetry`}
      />
    </div>
  );
}

type StatusTileProps = {
  live: boolean;
  label: string;
  count: number;
  countTestId: string;
  detail: string;
};

function StatusTile({ live, label, count, countTestId, detail }: StatusTileProps) {
  return (
    <div
      className={`surface-raised flex items-center gap-4 border-l-4 px-4 py-3 ${
        live ? "border-l-accent" : "border-l-warning"
      }`}
    >
      <span
        aria-hidden
        className={`inline-flex h-3 w-3 shrink-0 rounded-full ${
          live ? "bg-accent" : "border-2 border-warning"
        }`}
      />
      <span
        data-testid={countTestId}
        className={`font-condensed text-3xl font-bold ${live ? "text-ok-ink" : "text-warning-ink"}`}
      >
        {count}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold uppercase tracking-wide text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{detail}</span>
      </span>
    </div>
  );
}

type SiteGroupProps = {
  testId: string;
  title: string;
  live: boolean;
  sites: readonly LocationKpiSummary[];
};

/** `F4.259` — one group of site cards under a heading that carries its count. */
function SiteGroup({ testId, title, live, sites }: SiteGroupProps) {
  return (
    <section data-testid={testId} className="space-y-2">
      <h2
        className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${
          live ? "text-ok-ink" : "text-warning-ink"
        }`}
      >
        <span
          aria-hidden
          className={`inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-accent" : "border-2 border-warning"}`}
        />
        {`${title} (${sites.length})`}
      </h2>
      <div className="grid content-start gap-3 md:grid-cols-2">
        {sites.map((location) => (
          <LocationKpiCard key={location.id} location={location} />
        ))}
      </div>
    </section>
  );
}
