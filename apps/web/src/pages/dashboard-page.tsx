import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchLocationKpis } from "../api/locations";
import { useExecutiveDashboard } from "../hooks/use-executive-dashboard";
import { estimatePue } from "../lib/pue-estimate";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";
import { KpiTile } from "../components/kpi-tile";
import { LoadTrendChart } from "../components/load-trend-chart";
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
            Executive Summary · InfraPulse Operating Dashboard
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
          title="Executive Summary · InfraPulse Operating Dashboard"
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
          subtitle="Click a location to open its scoped dashboard"
          bodyClassName="p-3"
        >
          {locationQ.isLoading ? (
            <div className="text-sm text-bms-muted">Loading locations...</div>
          ) : locationQ.isError ? (
            <div className="text-sm text-red-700">Location KPIs unavailable.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(locationQ.data?.items ?? []).map((location) => {
                const hasLiveTelemetry = location.freshAssetCount > 0;
                return (
                  <Link
                    key={location.id}
                    to={`/locations/${location.id}/dashboard`}
                    className={`rounded-lg border bg-white p-3 shadow-sm transition hover:border-bms-green hover:shadow ${
                      hasLiveTelemetry
                        ? "border-emerald-300 ring-1 ring-emerald-100"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-condensed text-base font-bold text-bms-ink">
                          {location.name}
                        </div>
                        <div className="text-xs uppercase tracking-wide text-bms-muted">
                          {location.province ?? location.type} ·{" "}
                          {location.scopeLabel === "partial" ? "partial scope" : "full scope"}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                          {location.assetCount} assets
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            hasLiveTelemetry
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {hasLiveTelemetry ? "Live telemetry" : "No live telemetry"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="font-mono text-sm font-semibold text-bms-ink">
                          {location.totalKw.toFixed(1)}
                        </div>
                        <div className="text-bms-muted">kW</div>
                      </div>
                      <div>
                        <div
                          className={`font-mono text-sm font-semibold ${
                            hasLiveTelemetry ? "text-emerald-700" : "text-bms-ink"
                          }`}
                        >
                          {location.freshAssetCount}/{location.assetCount}
                        </div>
                        <div className="text-bms-muted">fresh</div>
                      </div>
                      <div>
                        <div className="font-mono text-sm font-semibold text-bms-ink">
                          {location.openAlarms}
                        </div>
                        <div className="text-bms-muted">alarms</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>

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
