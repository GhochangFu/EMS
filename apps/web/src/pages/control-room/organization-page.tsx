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
import { groupByOrganization } from "../../lib/location-kpi-groups";
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
            <OrganizationOverview items={items} organizationId={organizationId} />
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
};

function OrganizationOverview({ items, organizationId }: OrganizationOverviewProps) {
  // `F2.10` (ADR 0098 B12) — the site map's parent filter offers this organization's nodes.
  const scopeLocations = useAuthStore((s) => s.scope)?.locations ?? [];
  // Sorted by name, as `/` sorts a section (`groupByOrganization`).
  const sites = groupByOrganization(
    items.filter((item) => item.organization.id === organizationId),
  )[0].locations;
  const card = organizationCards(sites)[0];

  return (
    <>
      <ControlRoomBreadcrumb crumbs={controlRoomCrumbs(items, { organizationId })} />
      <PageHeader
        eyebrow="Control Room"
        title={card.organization.name}
        subtitle={`${card.organization.code} · ${card.siteCount} sites · ${card.sitesOnline} online · ${card.openAlarms} alarms`}
      />
      <OrganizationSiteMap
        key={organizationId}
        organizationId={organizationId}
        nodes={organizationNodes(scopeLocations, items, organizationId)}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div data-testid="control-room-sites" className="grid content-start gap-3 md:grid-cols-2">
          {sites.map((location) => (
            <LocationKpiCard key={location.id} location={location} />
          ))}
        </div>
        <ActiveAlarmsRail organizationId={organizationId} />
      </div>
      <HealthSummarySection organizationId={organizationId} />
      <OrganizationLoadTrend organizationId={organizationId} />
      <ScopedDashboardsList organizationId={organizationId} />
    </>
  );
}
