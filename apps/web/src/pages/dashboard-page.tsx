import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchLocationKpis } from "../api/locations";
import { useExecutiveDashboard } from "../hooks/use-executive-dashboard";
import { estimatePue } from "../lib/pue-estimate";
import {
  distinctOrganizations,
  filterByOrganization,
  groupByOrganization,
  type OrgFilter,
} from "../lib/location-kpi-groups";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";
import { KpiTile } from "../components/kpi-tile";
import { LoadTrendChart } from "../components/load-trend-chart";
import { LocationKpiCard } from "../components/location-kpi-card";
import { OrgLocationAccordion } from "../components/org-location-accordion";
import { HealthSummarySection } from "../components/asset-health/health-summary-section";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";

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

  const trendStatus = trendQuery.isLoading
    ? "loading"
    : trendQuery.isError
      ? "error"
      : chartPoints.length === 0
        ? "empty"
        : "ready";

  const fmtKw = (v: number | null) =>
    v === null || Number.isNaN(v) ? null : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const pueVal =
    displayTotalKw != null
      ? estimatePue(displayTotalKw)
      : kpi
        ? kpi.pueEstimate
        : null;

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              stale
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-900"
            }`}
          >
            {stale ? "Stale" : "Live"}
          </span>
          <span className="text-bms-ink">
            Executive Summary · TRINETRA Operating Dashboard
          </span>
          <span className="hidden text-bms-muted sm:inline">
            · Total load & alarms from telemetry + DB
          </span>
        </div>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.dash"
          title="Executive Summary · TRINETRA Operating Dashboard"
          subtitle="Live operational overview · KPI ribbon · telemetry trend"
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Total load"
            status={kpiStatus}
            value={fmtKw(displayTotalKw)}
            unit="kW"
            hint="Sum of latest kW per asset"
            stale={stale && kpiStatus === "ready"}
          />
          <KpiTile
            label="Sites online"
            status={kpiStatus}
            value={
              kpi ? `${kpi.sitesOnline} / ${kpi.sitesTotal}` : null
            }
            hint="Sites with fresh telemetry (~20s)"
            stale={stale && kpiStatus === "ready"}
          />
          <KpiTile
            label="Open alarms"
            status={kpiStatus}
            value={kpi ? String(kpi.alarmsOpen) : null}
            hint={
              kpi && kpi.alarmsCritical > 0
                ? `${kpi.alarmsCritical} critical`
                : "Unacknowledged rows"
            }
            tone={
              kpi && kpi.alarmsCritical > 0
                ? "critical"
                : kpi && kpi.alarmsOpen > 0
                  ? "warning"
                  : "default"
            }
            stale={stale && kpiStatus === "ready"}
          />
          <KpiTile
            label="PUE (est.)"
            status={kpiStatus}
            value={pueVal != null ? pueVal.toFixed(2) : null}
            hint="Heuristic from total kW"
            stale={stale && kpiStatus === "ready"}
          />
        </div>

        <SectionCard
          title="Location performance"
          subtitle={locationSubtitle}
          bodyClassName="p-3"
        >
          {locationQ.isLoading ? (
            <div className="text-sm text-bms-muted">Loading locations...</div>
          ) : locationQ.isError ? (
            <div className="text-sm text-red-700">Location KPIs unavailable.</div>
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
                    className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                      orgFilter === "all"
                        ? "border-bms-green bg-emerald-50 text-emerald-900"
                        : "border-gray-200 bg-white text-bms-ink"
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
                      className={`rounded border px-3 py-1.5 text-xs font-semibold ${
                        orgFilter === organization.code
                          ? "border-bms-green bg-emerald-50 text-emerald-900"
                          : "border-gray-200 bg-white text-bms-ink"
                      }`}
                      onClick={() => setOrgFilter(organization.code)}
                    >
                      {organization.code}
                    </button>
                  ))}
                </div>
              ) : null}
              {filteredLocations.length === 0 ? (
                <div className="text-sm text-bms-muted">
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
