import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { LocationDashboardDto } from "@bms/shared";

import { fetchLocationDashboard } from "../api/locations";
import {
  AssetImagesRow,
  AssetImagesToggleButton,
} from "../components/assets/asset-images-row-toggle";
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

/**
 * The asset table's columns, in order.
 *
 * Declared here rather than written out in the `<thead>` so that the F3.4
 * gallery row's `colSpan` is **derived** from the same list the headers come
 * from: a seventh column added to the header would otherwise leave the
 * full-width row one cell short, and nothing would say so.
 */
const assetTableColumns: ReadonlyArray<{ label: string; align?: "right" }> = [
  { label: "Asset" },
  { label: "RTU" },
  { label: "Telemetry" },
  { label: "Freshness" },
  { label: "Alarms & warnings" },
  { label: "Work orders", align: "right" },
];

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
    current_ir: "Current IR",
    current_iy: "Current IY",
    current_ib: "Current IB",
    frequency_hz: "Frequency",
    breaker_main: "Main pump",
    chlorine_pump_on: "Chlorine pump",
    battery_charge_pct: "Battery",
    network_strength: "Signal",
    kwh_total: "kWh total",
    kva: "kVA",
    kvar: "kVAr",
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
  const [rtuFilter, setRtuFilter] = useState<string>("all");
  // F3.4 Q-1: **one** open gallery, not a set of them. Two readers' galleries
  // on screen at once is not a state anyone asked for, and each open row holds
  // an authenticated blob read plus an object URL per thumbnail, so the single
  // id is both the simpler state and the cheaper one. It is also the shape the
  // admin panel uses on `/admin/assets` (`imagesFor`), so the two surfaces read
  // the same way.
  const [openImagesFor, setOpenImagesFor] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setRtuFilter("all");
  }, [locationId]);

  const q = useQuery({
    queryKey: ["dashboard", "location", locationId, page, pageSize, rtuFilter],
    queryFn: () =>
      fetchLocationDashboard(locationId!, {
        page,
        pageSize,
        rtuId: rtuFilter === "all" ? undefined : rtuFilter,
      }),
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
        <span className="text-ink">
          Location dashboard · {location?.name ?? "Loading"}
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.loc"
          title={location?.name ?? "Location Dashboard"}
          subtitle={
            location
              ? `${location.organization.name} · ${location.rtuCount} RTUs · scoped KPIs, assets, telemetry, alarms`
              : "Scoped KPIs, all assets, telemetry freshness, alarms, and module launch points"
          }
        />

        {location ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-canvas px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-ink">
              {location.organization.code}
            </span>
            <span className="rounded bg-well-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              {location.typeLabel}
            </span>
          </div>
        ) : null}

        {q.isError ? (
          <SectionCard title="Access denied" bodyClassName="p-4">
            <p className="text-sm text-ink-muted">
              This location is not available in your assigned access scope.
            </p>
            <Link className="mt-3 inline-block text-sm font-semibold text-accent-strong" to="/">
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

            {location && location.rtus.length > 0 ? (
              <SectionCard
                title="RTUs"
                subtitle="Gateways and domain simulators under this location"
                bodyClassName="p-3"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`surface-tab px-3 py-1.5 ${
                      rtuFilter === "all" ? "surface-tab-selected" : ""
                    }`}
                    onClick={() => {
                      setRtuFilter("all");
                      setPage(1);
                    }}
                  >
                    All RTUs
                  </button>
                  {location.rtus.map((rtu) => (
                    <button
                      key={rtu.id}
                      type="button"
                      className={`surface-tab px-3 py-1.5 ${
                        rtuFilter === rtu.id ? "surface-tab-selected" : ""
                      }`}
                      onClick={() => {
                        setRtuFilter(rtu.id);
                        setPage(1);
                      }}
                    >
                      {rtu.displayName}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {location.rtus.map((rtu) => (
                    <div
                      key={rtu.id}
                      className="surface-raised p-3"
                    >
                      <div className="font-semibold text-ink">{rtu.displayName}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-muted">
                        {rtu.sourceType}
                        {rtu.domain ? ` · ${rtu.domain}` : ""}
                        {rtu.ingestEnabled ? " · ingest on" : ""}
                      </div>
                      <div className="mt-2 font-mono text-sm text-ink">
                        {rtu.freshAssetCount}/{rtu.assetCount} fresh
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            <SectionCard
              title="Assets with Telemetry & Risk Overview"
              subtitle={
                assetPage
                  ? `Showing ${range.start}-${range.end} of ${assetPage.total} scoped assets`
                  : "All scoped assets with telemetry, alarms, warnings, and work orders"
              }
              actions={
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <label className="flex items-center gap-1">
                    Rows
                    <select
                      className="surface-field px-2 py-1 text-ink"
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
                    className="surface-button px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="surface-button px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
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
                <div className="p-4 text-sm text-ink-muted">
                  No assets configured for this location yet.
                </div>
              ) : location && location.assets.items.length === 0 ? (
                <div className="p-4 text-sm text-ink-muted">
                  No assets on this page. Use the pagination controls to move back.
                </div>
              ) : (
                <div className="overflow-hidden surface-table">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-well text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        {assetTableColumns.map((column) => (
                          <th
                            key={column.label}
                            className={`px-3 py-2${column.align === "right" ? " text-right" : ""}`}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(location?.assets.items ?? []).map((asset) => (
                        <Fragment key={asset.id}>
                        <tr className="border-t border-well-deep">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-ink">{asset.name}</div>
                            <div className="font-mono text-xs text-ink-muted">
                              {asset.code}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-muted">
                              {asset.domain}
                            </div>
                            <AssetImagesToggleButton
                              assetId={asset.id}
                              open={openImagesFor === asset.id}
                              onToggle={(id) =>
                                setOpenImagesFor((current) => (current === id ? null : id))
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-muted">
                            {asset.rtuDisplayName}
                          </td>
                          <td className="px-3 py-2">
                            {asset.telemetry.length === 0 ? (
                              <span className="text-xs text-ink-muted">No telemetry points</span>
                            ) : (
                              <div className="flex max-w-[420px] flex-wrap gap-1.5">
                                {asset.telemetry.slice(0, 5).map((sample) => (
                                  <span
                                    key={sample.pointKey}
                                    className="surface-pressed-sm px-2 py-1 font-mono text-[11px] text-ink"
                                    title={`${sample.pointKey} @ ${formatTime(sample.time)}`}
                                  >
                                    <span className="font-sans text-ink-muted">
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
                            <div className="mt-1 font-mono text-[11px] text-ink-muted">
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
                              <div className="mt-1 max-w-[320px] truncate text-[11px] text-ink-muted">
                                {asset.latestAlarm.message}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {asset.openWorkOrderCount > 0 ? (
                              <span className="font-semibold text-warning-ink">
                                {asset.openWorkOrderCount}
                              </span>
                            ) : (
                              <span className="text-ink-muted">0</span>
                            )}
                          </td>
                        </tr>
                        {/*
                          Rendered unconditionally: the row returns `null` while
                          closed, which is what keeps the gallery — and its
                          image requests — unmounted until a reader asks (Q-1).
                        */}
                        <AssetImagesRow
                          assetId={asset.id}
                          colSpan={assetTableColumns.length}
                          open={openImagesFor === asset.id}
                        />
                        </Fragment>
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
                    className="surface-button px-3 py-2 hover:border-accent"
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
