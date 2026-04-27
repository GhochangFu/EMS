import { useExecutiveDashboard } from "../hooks/use-executive-dashboard";
import { estimatePue } from "../lib/pue-estimate";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";
import { KpiTile } from "../components/kpi-tile";
import { LoadTrendChart } from "../components/load-trend-chart";

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
            Executive Summary · Eskom SMOC Operating Dashboard
          </span>
          <span className="hidden text-bms-muted sm:inline">
            · Total load & alarms from telemetry + DB
          </span>
        </div>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <header className="flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Executive Summary · ESKOM SMOC Operating Dashboard
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              Live operational overview — prototype Sprint 3 (mockup{" "}
              <span className="font-mono text-xs">R.dash</span> KPI row + energy
              trend).
            </p>
          </div>
        </header>

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

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="font-condensed text-sm font-bold text-bms-ink">
                Campus load · last 60 minutes
              </h2>
              <p className="text-[11px] text-bms-muted">
                1-minute buckets · total kW (all assets)
              </p>
            </div>
          </div>
          <div className="p-3">
            <LoadTrendChart
              points={chartPoints}
              status={trendStatus}
              stale={stale && trendStatus === "ready"}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
