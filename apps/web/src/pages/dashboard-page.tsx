import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchLocationKpis } from "../api/locations";
import { useExecutiveDashboard } from "../hooks/use-executive-dashboard";
import { FRESH_MS } from "../lib/schematic-telemetry";
import { kpiRibbonHints } from "../lib/kpi-ribbon";
import { pueTileProps } from "../lib/pue-tile";
import {
  distinctOrganizations,
  filterByOrganization,
  groupByOrganization,
  type OrgFilter,
} from "../lib/location-kpi-groups";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";
import { KpiTile } from "../components/kpi-tile";
import { WidgetIconGlyph } from "../components/widget-icon";
import { LoadTrendChart } from "../components/load-trend-chart";
import { LocationKpiCard } from "../components/location-kpi-card";
import { OrgLocationAccordion } from "../components/org-location-accordion";
import { HealthSummarySection } from "../components/asset-health/health-summary-section";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";

const DASHBOARD_TITLE = "Executive Summary · IONSiTE NEXUS Operating Dashboard";

type DashboardPageProps = {
  user: AuthUser;
};

export function DashboardPage({ user }: DashboardPageProps) {
  const {
    kpiQuery,
    trendQuery,
    stale,
    displayTotalKw,
    chartPoints,
  } = useExecutiveDashboard();
  const locationQ = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
    refetchInterval: 8000,
  });
  const [orgFilter, setOrgFilter] = useState<OrgFilter>("all");

  const locationItems = locationQ.data?.items ?? [];
  const organizations = useMemo(
    () => distinctOrganizations(locationItems),
    [locationItems],
  );
  const filteredLocations = useMemo(
    () => filterByOrganization(locationItems, orgFilter),
    [locationItems, orgFilter],
  );
  const groupedLocations = useMemo(
    () => (orgFilter === "all" ? groupByOrganization(filteredLocations) : []),
    [filteredLocations, orgFilter],
  );

  const locationSubtitle =
    orgFilter === "all"
      ? "Click a location to open its scoped dashboard"
      : `Showing ${orgFilter} locations only`;

  const kpi = kpiQuery.data;
  const kpiStatus = kpiQuery.isLoading
    ? "loading"
    : kpiQuery.isError
      ? "error"
      : "ready";

  /**
   * `F2.8` — computed once, because the tile's `stale` prop has to be decided
   * against **this** status and not against `kpiStatus`. `pueTileProps` turns a
   * settled query that returned `null` into `"empty"`, and `KpiTile` draws its
   * amber stale ring for any truthy `stale` — so `stale && kpiStatus === "ready"`
   * ringed an unconfigured estate's `—` in an alarm colour with nothing to say
   * why. `F4.164` U1 made the caption follow the same truthy `stale` the ring
   * does, so the caller still decides whether a non-ready tile is stale, but no
   * longer needs to gate the caption separately from the ring.
   */
  const pueProps = pueTileProps(kpiStatus, kpi?.pueEstimate);
  // `F3.28` task 2.5 — vs-yesterday deltas; see `kpi-ribbon.ts` for why Total
  // load compares the server's `totalKw` while the tile shows the socket sum.
  const hints = kpiRibbonHints(kpi);

  const trendStatus = trendQuery.isLoading
    ? "loading"
    : trendQuery.isError
      ? "error"
      : chartPoints.length === 0
        ? "empty"
        : "ready";

  const fmtKw = (v: number | null) =>
    v === null || Number.isNaN(v) ? null : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full surface-pill px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              stale
                ? "bg-warning-wash-strong text-warning-ink"
                : "bg-ok-wash text-ok-ink"
            }`}
          >
            {stale ? "Stale" : "Live"}
          </span>
          <span className="text-ink">
            {DASHBOARD_TITLE}
          </span>
          <span className="hidden text-ink-muted sm:inline">
            · Total load & alarms from telemetry + DB
          </span>
        </div>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.dash"
          title={DASHBOARD_TITLE}
          subtitle="Live operational overview · KPI ribbon · telemetry trend"
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Total load"
            status={kpiStatus}
            value={fmtKw(displayTotalKw)}
            unit="kW"
            hint={hints.totalLoadHint}
            icon={WidgetIconGlyph("bolt")}
            stale={stale && kpiStatus === "ready"}
          />
          <KpiTile
            label="Sites online"
            status={kpiStatus}
            value={
              kpi ? `${kpi.sitesOnline} / ${kpi.sitesTotal}` : null
            }
            hint={`Sites with fresh telemetry (~${FRESH_MS / 1000}s)`}
            stale={stale && kpiStatus === "ready"}
          />
          <KpiTile
            label="Open alarms"
            status={kpiStatus}
            value={kpi ? String(kpi.alarmsOpen) : null}
            hint={hints.openAlarmsHint}
            note={hints.openAlarmsNote}
            icon={WidgetIconGlyph("alert")}
            tone={
              kpi && kpi.alarmsCritical > 0
                ? "critical"
                : kpi && kpi.alarmsOpen > 0
                  ? "warning"
                  : "default"
            }
            stale={stale && kpiStatus === "ready"}
          />
          {/*
            `F2.8` — a measured ratio, not a curve. This tile used to prefer a
            client-side copy of the API's fitted heuristic over the API's own
            number whenever telemetry was live, so it could disagree with the
            CSV export of the same estate. It now refreshes with `kpiQuery`,
            whose `refetchInterval` is 4 s (`use-executive-dashboard.ts`), and
            the value is at most one 60 s engine tick old. The plan's §5 and §11
            both say 8 s; 8 s is `locationQ` on this page, a different query.
          */}
          <KpiTile
            label="PUE"
            {...pueProps}
            hint={hints.pueDeltaText ?? pueProps.hint}
            icon={WidgetIconGlyph("gauge")}
            stale={stale && pueProps.status === "ready"}
          />
        </div>

        <SectionCard
          title="Location performance"
          subtitle={locationSubtitle}
          bodyClassName="p-3"
        >
          {locationQ.isLoading ? (
            <div className="text-sm text-ink-muted">Loading locations...</div>
          ) : locationQ.isError ? (
            <div className="text-sm text-critical-ink">Location KPIs unavailable.</div>
          ) : (
            <>
              {organizations.length > 0 ? (
                <div
                  className="mb-3 flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="Filter locations by organization"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={orgFilter === "all"}
                    className={`surface-tab px-3 py-1.5 ${
                      orgFilter === "all" ? "surface-tab-selected" : ""
                    }`}
                    onClick={() => setOrgFilter("all")}
                  >
                    All
                  </button>
                  {organizations.map((organization) => (
                    <button
                      key={organization.id}
                      type="button"
                      role="tab"
                      aria-selected={orgFilter === organization.code}
                      className={`surface-tab px-3 py-1.5 ${
                        orgFilter === organization.code ? "surface-tab-selected" : ""
                      }`}
                      onClick={() => setOrgFilter(organization.code)}
                    >
                      {organization.code}
                    </button>
                  ))}
                </div>
              ) : null}
              {filteredLocations.length === 0 ? (
                <div className="text-sm text-ink-muted">
                  No locations in this organization for your access scope.
                </div>
              ) : orgFilter === "all" ? (
                <OrgLocationAccordion groups={groupedLocations} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredLocations.map((location) => (
                    <LocationKpiCard key={location.id} location={location} />
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <HealthSummarySection />

        <SectionCard
          title="Campus load · last 60 minutes"
          subtitle="1-minute buckets · total kW (all assets)"
          bodyClassName="p-3"
        >
            <LoadTrendChart
              points={chartPoints}
              status={trendStatus}
              stale={stale && trendStatus === "ready"}
            />
        </SectionCard>
      </div>
    </AppShell>
  );
}
