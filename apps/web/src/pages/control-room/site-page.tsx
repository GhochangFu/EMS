import type { AccessibleScope, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { fetchResolvedSiteControlRoomView } from "../../api/control-room";
import { fetchLocationKpis } from "../../api/locations";
import { ControlRoomBreadcrumb } from "../../components/control-room/control-room-breadcrumb";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { canAccessControlRoomPath } from "../../lib/control-room-access";
import { controlRoomCrumbs } from "../../lib/control-room-levels";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import { SMOC_PAGES } from "../../lib/smoc-pages";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

type ControlRoomSitePageProps = {
  user: AuthUser;
};

const linkClass = "mt-2 inline-block text-sm font-semibold text-bms-green hover:underline";

/**
 * `F3.66` (ADR 0076 decisions 2 and 5) — `/control-room/site/:locationId`, the
 * site view host. The name, the organization and the crumbs come from the KPI
 * list; the body comes from `F3.67`'s resolve read, one per `kind`: the
 * generated interim (D7), the SMOC links filtered by the per-area rule (OQ1),
 * or a link card to the configured dashboard (OQ2). A rejected resolve read —
 * the API answers 404 for a site outside the scope — shows the not-available
 * card and never an interim body (D6). `useControlRoomAccess` is not consulted
 * (D8): `ControlRoomRoute` still guards each `/cr-*` page.
 */
export function ControlRoomSitePage({ user }: ControlRoomSitePageProps) {
  const { locationId = "" } = useParams();
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

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">Control Room · site view</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        {items !== undefined ? (
          site !== undefined && !siteView.isError ? (
            <>
              <ControlRoomBreadcrumb crumbs={controlRoomCrumbs(items, { locationId })} />
              <PageHeader
                eyebrow="Control Room"
                title={site.name}
                subtitle={`${site.organization.name} · ${site.organization.code}`}
              />
              {siteView.data !== undefined ? (
                <SiteViewBody view={siteView.data} site={site} scope={scope} />
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
};

function SiteViewBody({ view, site, scope }: SiteViewBodyProps) {
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
      {view.kind === "builtin" ? (
        <SectionCard title="Control Room pages" bodyClassName="p-4">
          <ul data-testid="smoc-pages" className="grid gap-2 sm:grid-cols-2">
            {SMOC_PAGES.filter((page) => canAccessControlRoomPath(scope, page.path)).map((page) => (
              <li key={page.path}>
                <Link to={page.path} className="text-sm font-semibold text-bms-green hover:underline">
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : view.kind === "dashboard" && view.dashboardSlug !== null ? (
        // The resolve DTO carries the slug, not the dashboard's name; the
        // dashboard belongs to the site's organization (the admin write checks
        // it), so the KPI row supplies the organization id. `F3.69` replaces this.
        <SectionCard title="Site dashboard" bodyClassName="p-4">
          <p className="text-sm text-bms-muted">
            This site shows the dashboard {view.dashboardSlug}.
          </p>
          <Link
            to={`/dashboards/${encodeURIComponent(view.dashboardSlug)}?organizationId=${encodeURIComponent(site.organization.id)}`}
            className={linkClass}
          >
            Open the dashboard
          </Link>
        </SectionCard>
      ) : (
        // D7 seam with `F3.68`: whichever PR merges second replaces this
        // interim with `<GeneratedSiteView locationId={site.id} />`.
        <SectionCard title="Generated site view" bodyClassName="p-4">
          <p className="text-sm text-bms-muted">
            The generated site view arrives with F3.68. Until then, open the site dashboard.
          </p>
          <Link to={`/locations/${site.id}/dashboard`} className={linkClass}>
            Open the site dashboard
          </Link>
        </SectionCard>
      )}
    </>
  );
}
