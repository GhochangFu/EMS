import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchLocationKpis } from "../../api/locations";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { controlRoomEntryTarget } from "../../lib/control-room-levels";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardPage } from "../dashboard-page";
import { ControlRoomOrganizationPage } from "./organization-page";
import { ControlRoomSitePage } from "./site-page";

type ControlRoomOrganizationsPageProps = {
  user: AuthUser;
  /**
   * `F3.72` (plan D1, OQ2) — set on `/`, which is not wrapped in
   * `ControlRoomScopeRoute`: the page renders the caller's entry level **in
   * place** and the URL stays `/`. Unset on `/control-room`, where a level
   * that holds one item redirects.
   */
  entry?: boolean;
};

/**
 * `F3.66` (ADR 0076 decision 2) — `/control-room`, grouped from the same
 * `["dashboard","locations"]` read the estate uses. A level that holds one
 * item is skipped: one organization lands on its overview, one site lands on
 * the site. The decision waits for data (plan D1): a pending read is never
 * taken for an empty list.
 *
 * `F3.72` (ADR 0087 decisions 1–3, plan D1) — the organizations level is the
 * estate: `<DashboardPage />`, which holds the organization cards, replaces
 * this page's own card grid. With `entry` (at `/`) the organization and site
 * levels render in place instead of redirecting. Every level page renders its
 * own `AppShell`, so each is returned before this page's shell, never inside
 * it. `DashboardPage` imports nothing from this file, so there is no cycle.
 */
export function ControlRoomOrganizationsPage({ user, entry = false }: ControlRoomOrganizationsPageProps) {
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
    refetchInterval: 8000,
  });

  const items = locationQ.data?.items;

  if (items !== undefined) {
    const target = controlRoomEntryTarget(items);
    if (target.level === "organization") {
      return entry ? (
        <ControlRoomOrganizationPage user={user} organizationId={target.organizationId} />
      ) : (
        <Navigate to={`/control-room/org/${target.organizationId}`} replace />
      );
    }
    if (target.level === "site") {
      return entry ? (
        <ControlRoomSitePage user={user} locationId={target.locationId} />
      ) : (
        <Navigate to={`/control-room/site/${target.locationId}`} replace />
      );
    }
    if (target.level === "organizations") {
      return <DashboardPage user={user} />;
    }
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-ink">Control Room · organizations in your access scope</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Control Room"
          title="Control Room"
          subtitle="Choose an organization to open its sites"
        />
        {items !== undefined ? (
          // Only an empty list reaches here: every other target returned above.
          <SectionCard title="No sites in your access scope" bodyClassName="p-4">
            <p className="text-sm text-ink-muted">
              Ask an administrator for access to a site.
            </p>
          </SectionCard>
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
