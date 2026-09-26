import type { LocationKpiSummary } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchLocationKpis } from "../../api/locations";
import { ActiveAlarmsRail } from "../../components/control-room/active-alarms-rail";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
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
import type { AuthUser } from "../../stores/auth-store";

type ControlRoomOrganizationPageProps = {
  user: AuthUser;
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
 */
export function ControlRoomOrganizationPage({ user }: ControlRoomOrganizationPageProps) {
  const { organizationId = "" } = useParams();
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
      kpiRibbon={<span className="text-bms-ink">Control Room · sites and active alarms</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        {items !== undefined && target !== null ? (
          target.level === "empty" ? (
            <SectionCard title="No sites for this organization in your access scope" bodyClassName="p-4">
              <p className="text-sm text-bms-muted">
                This organization holds no site you can read.
              </p>
              <Link
                to="/control-room"
                className="mt-2 inline-block text-sm font-semibold text-bms-green hover:underline"
              >
                Back to the Control Room
              </Link>
            </SectionCard>
          ) : (
            <OrganizationOverview items={items} organizationId={organizationId} />
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

type OrganizationOverviewProps = {
  items: readonly LocationKpiSummary[];
  organizationId: string;
};

function OrganizationOverview({ items, organizationId }: OrganizationOverviewProps) {
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div data-testid="control-room-sites" className="grid content-start gap-3 md:grid-cols-2">
          {sites.map((location) => (
            <LocationKpiCard
              key={location.id}
              location={location}
              to={`/control-room/site/${location.id}`}
            />
          ))}
        </div>
        <ActiveAlarmsRail organizationId={organizationId} />
      </div>
    </>
  );
}
