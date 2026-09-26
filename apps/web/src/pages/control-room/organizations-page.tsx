import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";

import { fetchLocationKpis } from "../../api/locations";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { controlRoomEntryTarget, organizationCards } from "../../lib/control-room-levels";
import type { AuthUser } from "../../stores/auth-store";

type ControlRoomOrganizationsPageProps = {
  user: AuthUser;
};

/**
 * `F3.66` (ADR 0076 decision 2) — `/control-room`, one card per readable
 * organization, grouped from the same `["dashboard","locations"]` read `/`
 * uses. A level that holds one item is skipped: one organization lands on its
 * overview, one site lands on the site. The decision waits for data (plan D1):
 * a pending read is never taken for an empty list.
 */
export function ControlRoomOrganizationsPage({ user }: ControlRoomOrganizationsPageProps) {
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
    refetchInterval: 8000,
  });

  const items = locationQ.data?.items;

  if (items !== undefined) {
    const target = controlRoomEntryTarget(items);
    if (target.level === "organization") {
      return <Navigate to={`/control-room/org/${target.organizationId}`} replace />;
    }
    if (target.level === "site") {
      return <Navigate to={`/control-room/site/${target.locationId}`} replace />;
    }
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">Control Room · organizations in your access scope</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Control Room"
          title="Control Room"
          subtitle="Choose an organization to open its sites"
        />
        {items !== undefined ? (
          items.length === 0 ? (
            <SectionCard title="No sites in your access scope" bodyClassName="p-4">
              <p className="text-sm text-bms-muted">
                Ask an administrator for access to a site.
              </p>
              <Link to="/" className="mt-2 inline-block text-sm font-semibold text-bms-green hover:underline">
                Back to the dashboard
              </Link>
            </SectionCard>
          ) : (
            <div
              data-testid="control-room-organizations"
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {organizationCards(items).map((card) => (
                <Link
                  key={card.organization.id}
                  to={`/control-room/org/${card.organization.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-bms-green hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-condensed text-base font-bold text-bms-ink">
                      {card.organization.name}
                    </div>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                      {card.organization.code}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-bms-muted">
                    {`${card.siteCount} sites · ${card.sitesOnline} online · ${card.openAlarms} alarms`}
                  </div>
                </Link>
              ))}
            </div>
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
