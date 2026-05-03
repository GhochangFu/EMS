import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { LocationDashboardDto } from "@bms/shared";

import { fetchLocationDashboard } from "../api/locations";
import { KpiTile } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type LocationDashboardPageProps = {
  user: AuthUser;
};

type LocationAssetRow = LocationDashboardDto["assets"]["items"][number];

const pageSizeOptions = [10, 25, 50] as const;

function freshnessLabel(freshness: LocationAssetRow["freshness"]): string {
  if (freshness === "live") {
    return "Live";
  }
  if (freshness === "stale") {
    return "Stale";
  }
  return "No telemetry";
}

function freshnessTone(
  freshness: LocationAssetRow["freshness"],
): "ok" | "warning" | "offline" {
  if (freshness === "live") {
    return "ok";
  }
  if (freshness === "stale") {
    return "warning";
  }
  return "offline";
}

function telemetryLabel(pointKey: string): string {
  const labels: Record<string, string> = {
    kw: "Load",
    voltage_l1_v: "Voltage",
    current_a: "Current",
    pf: "PF",
    breaker_main: "Breaker",
    supply_air_temp_c: "Supply",
    return_air_temp_c: "Return",
    fan_speed_pct: "Fan",
    cooling_kw: "Cooling",
    rack_kw: "Rack load",
    rack_temp_c: "Rack temp",
    pdu_util_pct: "PDU",
    temperature_c: "Temp",
    humidity_pct: "Humidity",
    leak_state: "Leak",
    smoke_state: "Smoke",
  };
  return labels[pointKey] ?? pointKey.replace(/_/g, " ");
}

function formatTelemetryValue(
  sample: LocationAssetRow["telemetry"][number],
): string {
  return `${sample.value.toFixed(sample.value >= 100 ? 0 : 1)}${sample.unit ? ` ${sample.unit}` : ""}`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function LocationDashboardPage({ user }: LocationDashboardPageProps) {
  const { locationId } = useParams();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(10);

  useEffect(() => {
    setPage(1);
  }, [locationId]);

  const q = useQuery({
    queryKey: ["dashboard", "location", locationId, page, pageSize],
    queryFn: () => fetchLocationDashboard(locationId!, { page, pageSize }),
    enabled: !!locationId,
    refetchInterval: 8000,
  });
  const location = q.data;
  const status = q.isLoading ? "loading" : q.isError ? "error" : "ready";
  const assetPage = location?.assets;
  const range = useMemo(() => {
    if (!assetPage || assetPage.total === 0) {
      return { start: 0, end: 0 };
    }
    return {
      start: (assetPage.page - 1) * assetPage.pageSize + 1,
      end: Math.min(assetPage.page * assetPage.pageSize, assetPage.total),
    };
  }, [assetPage]);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Location dashboard · {location?.name ?? "Loading"}
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.loc"
          title={location?.name ?? "Location Dashboard"}
          subtitle="Scoped KPIs, all assets, telemetry freshness, alarms, and module launch points"
        />

        {q.isError ? (
          <SectionCard title="Access denied" bodyClassName="p-4">
            <p className="text-sm text-bms-muted">
              This location is not available in your assigned access scope.
            </p>
            <Link className="mt-3 inline-block text-sm font-semibold text-bms-green" to="/">
              Return to Main Dashboard
            </Link>
          </SectionCard>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Total load"
                status={status}
                value={location ? location.totalKw.toFixed(1) : null}
                unit="kW"
                hint={location?.scopeLabel === "partial" ? "Limited asset group" : "All assets"}
              />
              <KpiTile
                label="Assets fresh"
                status={status}
                value={
                  location
                    ? `${location.freshAssetCount} / ${location.assetCount}`
                    : null
                }
                hint="Telemetry freshness window"
              />
              <KpiTile
                label="Open alarms"
                status={status}
                value={location ? String(location.openAlarms) : null}
                hint={
                  location && location.criticalAlarms > 0
                    ? `${location.criticalAlarms} critical`
                    : "Unacknowledged rows"
                }
              />
              <KpiTile
                label="Open work orders"
                status={status}
                value={location ? String(location.workOrdersOpen) : null}
                hint="Non-closed work orders"
              />
            </div>

            <SectionCard
              title="Assets with Telemetry & Risk Overview"
              subtitle={
                assetPage
                  ? `Showing ${range.start}-${range.end} of ${assetPage.total} scoped assets`
                  : "All scoped assets with telemetry, alarms, warnings, and work orders"
              }
              actions={
                <div className="flex items-center gap-2 text-xs text-bms-muted">
                  <label className="flex items-center gap-1">
                    Rows
                    <select
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-bms-ink"
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value) as typeof pageSize);
                        setPage(1);
                      }}
                    >
                      {pageSizeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded border border-gray-200 px-2 py-1 font-semibold text-bms-ink disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!assetPage || assetPage.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Prev
                  </button>
                  <span className="font-mono">
                    {assetPage ? `${assetPage.page}/${Math.max(1, assetPage.totalPages)}` : "0/0"}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-gray-200 px-2 py-1 font-semibold text-bms-ink disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!assetPage || assetPage.page >= assetPage.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              }
              bodyClassName="p-0"
            >
              {location && location.assetCount === 0 ? (
                <div className="p-4 text-sm text-bms-muted">
                  No assets configured for this location yet.
                </div>
              ) : location && location.assets.items.length === 0 ? (
                <div className="p-4 text-sm text-bms-muted">
                  No assets on this page. Use the pagination controls to move back.
                </div>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-bms-muted">
                      <tr>
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Telemetry</th>
                        <th className="px-3 py-2">Freshness</th>
                        <th className="px-3 py-2">Alarms & warnings</th>
                        <th className="px-3 py-2 text-right">Work orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(location?.assets.items ?? []).map((asset) => (
                        <tr key={asset.id} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-bms-ink">{asset.name}</div>
                            <div className="font-mono text-xs text-bms-muted">
                              {asset.code}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-bms-muted">
                              {asset.domain}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {asset.telemetry.length === 0 ? (
                              <span className="text-xs text-bms-muted">No telemetry points</span>
                            ) : (
                              <div className="flex max-w-[420px] flex-wrap gap-1.5">
                                {asset.telemetry.slice(0, 5).map((sample) => (
                                  <span
                                    key={sample.pointKey}
                                    className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-bms-ink"
                                    title={`${sample.pointKey} @ ${formatTime(sample.time)}`}
                                  >
                                    <span className="font-sans text-bms-muted">
                                      {telemetryLabel(sample.pointKey)}:
                                    </span>{" "}
                                    {formatTelemetryValue(sample)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill
                              label={freshnessLabel(asset.freshness)}
                              tone={freshnessTone(asset.freshness)}
                            />
                            <div className="mt-1 font-mono text-[11px] text-bms-muted">
                              {formatTime(asset.latestTelemetryAt)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {asset.criticalAlarmCount > 0 ? (
                                <StatusPill
                                  label={`${asset.criticalAlarmCount} critical`}
                                  tone="critical"
                                />
                              ) : null}
                              {asset.warningAlarmCount > 0 ? (
                                <StatusPill
                                  label={`${asset.warningAlarmCount} warning`}
                                  tone="warning"
                                />
                              ) : null}
                              {asset.openAlarmCount === 0 ? (
                                <StatusPill label="Clear" tone="ok" />
                              ) : null}
                            </div>
                            {asset.latestAlarm ? (
                              <div className="mt-1 max-w-[320px] truncate text-[11px] text-bms-muted">
                                {asset.latestAlarm.message}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {asset.openWorkOrderCount > 0 ? (
                              <span className="font-semibold text-amber-700">
                                {asset.openWorkOrderCount}
                              </span>
                            ) : (
                              <span className="text-bms-muted">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Available modules"
              subtitle="Direct links preserve the same location and asset access scope"
              bodyClassName="p-3"
            >
              <div className="flex flex-wrap gap-2">
                {[
                  ["Alarm Centre", "/alarms"],
                  ["Energy Centre", "/energy"],
                  ["Work Orders", "/work-orders"],
                  ["Maintenance", "/maintenance-schedules"],
                  ["Rules", "/rules"],
                  ["Reports", "/reports"],
                ].map(([label, path]) => (
                  <Link
                    key={path}
                    className="rounded border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-bms-ink hover:border-bms-green"
                    to={path}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
