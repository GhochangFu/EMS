import type { LocationKpiSummary } from "@bms/shared";
import { useQueries } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";

import { fetchResolvedSiteControlRoomView } from "../../api/control-room";
import { fetchDashboard } from "../../api/dashboards";
import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";
import { stationTabs } from "../../lib/station-view";
import { siteTabHref } from "../widgets/site-widget-parts";
import { GeneratedSiteView } from "./generated-site-view";
import { SiteDashboardView } from "./site-dashboard-view";

type StationSiteHalvesProps = {
  /** The station's id: the route's `:locationId`, so the chooser's links stay on the station page. */
  stationId: string;
  /** The station's sites, in the KPI list's order (`stationGroupOf`'s `sites`). */
  sites: readonly LocationKpiSummary[];
  /** The route's raw `:tab` segment (`undefined` at the bare path); never `assets`, the page owns it. */
  tab: string | undefined;
};

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8, D9, D12) — both sites side by side on the
 * station's view, under one tab chooser.
 *
 * Each half is that site's own view, read through that site's own routes and checks: the site's
 * resolve read and, for a `dashboard` view, its dashboard read, under the very keys and with the very
 * reads the site page and `SiteDashboardView` use (`["control-room", "site-view", id]`, `retry:
 * false`; `["dashboards", "detail", slug, organizationId]`), so the cache is shared and a half adds
 * no request of its own. No read here names the station.
 *
 * **The tab** is the route's `:tab` segment (D8), because the widget links inside each half already
 * point there. The chooser is `stationTabs` over the sites' dashboards; the bare path selects its
 * first key. A segment no site's dashboard holds redirects to the bare station path once every
 * site's reads have settled, never while one is pending; that includes `trends` until the station
 * has its own Trends & Energy arm (`stationTabs` drops the page's own segments).
 *
 * **A half** carries the site's name and a link to the site's page. A `dashboard` view draws
 * `SiteDashboardView` `embedded` (no inner strip, no redirect, no marker read; no `role`, so the
 * trend strip wizard stays on the site's own page), or "No <label> tab at this site." when its
 * dashboard lacks the chosen key. Any other view draws the site's generated view for every tab. A
 * pending resolve says so; a rejected one says the site's view is not available. More than two sites
 * wrap two per row; below `lg` the halves stack.
 *
 * Matched by key and kind only; no code names a level, a type or an organization (ADR 0098
 * decision 7). Spec: `station-site-halves.spec.tsx`.
 */
export function StationSiteHalves({ stationId, sites, tab }: StationSiteHalvesProps) {
  const resolves = useQueries({
    queries: sites.map((site) => ({
      queryKey: ["control-room", "site-view", site.id],
      queryFn: () => fetchResolvedSiteControlRoomView(site.id),
      // As on the site page: a 404 is the answer for a site outside the scope, not a transient failure.
      retry: false,
    })),
  });
  const slugs = resolves.map((read) =>
    read.data?.kind === "dashboard" ? read.data.dashboardSlug : null,
  );
  const details = useQueries({
    queries: sites.map((site, index) => ({
      queryKey: ["dashboards", "detail", slugs[index] ?? null, site.organization.id],
      queryFn: () => fetchDashboard(slugs[index] as string, site.organization.id),
      enabled: slugs[index] !== null,
    })),
  });

  const dashboards = details.map((read, index) => (slugs[index] === null ? undefined : read.data));
  const tabs = stationTabs(dashboards);
  const chosen = tab === undefined ? tabs[0] : tabs.find((entry) => entry.key === tab);
  const settled =
    resolves.every((read) => read.status !== "pending") &&
    details.every((read, index) => slugs[index] === null || read.status !== "pending");
  const stationPath = `/control-room/site/${encodeURIComponent(stationId)}`;

  if (tab !== undefined && chosen === undefined && settled) {
    return <Navigate to={stationPath} replace />;
  }

  // While a read is pending the raw segment is handed on; `embedded` never redirects on it.
  const key = chosen?.key ?? tab;

  return (
    <div className="space-y-3">
      {tabs.length > 0 ? (
        <nav aria-label="Station tabs" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {tabs.map((entry) => (
            <Link
              key={entry.key}
              to={siteTabHref(stationPath, entry.key)}
              aria-current={entry.key === key ? "page" : undefined}
              className={`surface-tab px-3 py-1.5 ${FOCUS_OUTLINE_CLASS} ${entry.key === key ? "surface-tab-selected" : ""}`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {sites.map((site, index) => {
          const resolve = resolves[index];
          const slug = slugs[index];
          const detail = dashboards[index];
          const lacksKey =
            detail !== undefined && key !== undefined && !detail.tabs.some((entry) => entry.key === key);
          return (
            <section key={site.id} aria-label={site.name} className="min-w-0 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-condensed text-base font-bold text-ink">{site.name}</h2>
                <Link
                  to={`/control-room/site/${encodeURIComponent(site.id)}`}
                  aria-label={`Open ${site.name} site page`}
                  className={`text-sm font-semibold text-accent-strong hover:underline ${FOCUS_OUTLINE_CLASS}`}
                >
                  Site page
                </Link>
              </div>
              {resolve?.data === undefined ? (
                <p role="status" className="text-sm text-ink-muted">
                  {resolve?.isError ? "This site's view is not available." : `Loading ${site.name}…`}
                </p>
              ) : slug !== null ? (
                lacksKey ? (
                  <p role="status" className="text-sm text-ink-muted">
                    {`No ${chosen?.label ?? key} tab at this site.`}
                  </p>
                ) : (
                  <SiteDashboardView
                    slug={slug}
                    organizationId={site.organization.id}
                    locationId={site.id}
                    tab={key}
                    energyShown={site.energyShown}
                    embedded
                  />
                )
              ) : (
                <GeneratedSiteView locationId={site.id} energyShown={site.energyShown} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
