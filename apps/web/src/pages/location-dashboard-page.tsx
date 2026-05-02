import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { fetchLocationDashboard } from "../api/locations";
import { KpiTile } from "../components/kpi-tile";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type LocationDashboardPageProps = {
  user: AuthUser;
};

export function LocationDashboardPage({ user }: LocationDashboardPageProps) {
  const { locationId } = useParams();
  const q = useQuery({
    queryKey: ["dashboard", "location", locationId],
    queryFn: () => fetchLocationDashboard(locationId!),
    enabled: !!locationId,
    refetchInterval: 8000,
  });
  const location = q.data;
  const status = q.isLoading ? "loading" : q.isError ? "error" : "ready";

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
          subtitle="Scoped KPIs, top assets, alarms, and module launch points"
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
              title="Top assets"
              subtitle="Latest kW where telemetry exists"
              bodyClassName="p-0"
            >
              {location && location.assetCount === 0 ? (
                <div className="p-4 text-sm text-bms-muted">
                  No assets configured for this location yet.
                </div>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-bms-muted">
                      <tr>
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Domain</th>
                        <th className="px-3 py-2 text-right">Latest kW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(location?.topAssets ?? []).map((asset) => (
                        <tr key={asset.id} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-bms-ink">{asset.name}</div>
                            <div className="font-mono text-xs text-bms-muted">
                              {asset.code}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-bms-muted">{asset.domain}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {asset.kw == null ? "n/a" : asset.kw.toFixed(1)}
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
