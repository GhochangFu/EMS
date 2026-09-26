import { useQuery } from "@tanstack/react-query";

import { fetchGeneratedSiteView } from "../../api/generated-site-view";
import { fetchLocationDashboard } from "../../api/locations";
import { useSiteLiveReadings } from "../../hooks/use-site-live-readings";
import { KpiTile, type KpiTileStatus } from "../kpi-tile";
import { SectionCard } from "../section-card";
import { GeneratedSiteAssetCard } from "./generated-site-asset-card";

/**
 * `F3.68` U6 — the generated site view (ADR 0076 decision 7).
 *
 * Self-contained on `{ locationId }`: no `AppShell`, no breadcrumb and no
 * notice banner — `F3.66`'s site page hosts it and owns all three (the plan's
 * "Seam with F3.66").
 *
 * - **Site KPIs** come from the existing `/dashboard/locations/:id` read,
 *   refetched every 8 s like the location page (D5); the tile labels, hints
 *   and the value formats are that page's.
 * - **One panel per domain**, in the order the server sends them, one card
 *   per asset in scope (D4, D6). The generated read itself refetches every
 *   30 s, so a new asset or a changed rank appears without a remount.
 * - **The live overlay** is `useSiteLiveReadings`: one socket, the shared
 *   staleness gate, one tick (D3).
 *
 * The two reads fail independently: either error line leaves the other
 * read's content on screen.
 */
export function GeneratedSiteView({ locationId }: { locationId: string }) {
  const kpiQuery = useQuery({
    queryKey: ["dashboard", "location", locationId],
    queryFn: () => fetchLocationDashboard(locationId),
    enabled: !!locationId,
    refetchInterval: 8000,
  });
  const viewQuery = useQuery({
    queryKey: ["control-room", "generated-site-view", locationId],
    queryFn: () => fetchGeneratedSiteView(locationId),
    enabled: !!locationId,
    refetchInterval: 30000,
  });
  const readings = useSiteLiveReadings(locationId, viewQuery.data);

  const location = kpiQuery.data;
  const kpiStatus: KpiTileStatus = kpiQuery.isLoading ? "loading" : kpiQuery.isError ? "error" : "ready";
  const view = viewQuery.data;

  return (
    <div className="space-y-4">
      {kpiQuery.isError ? (
        <p role="alert" className="text-sm text-red-600">
          Could not load the site KPIs.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label="Total load"
          status={kpiStatus}
          value={location ? location.totalKw.toFixed(1) : null}
          unit="kW"
          hint={location?.scopeLabel === "partial" ? "Limited asset group" : "All assets"}
        />
        <KpiTile
          label="Assets fresh"
          status={kpiStatus}
          value={location ? `${location.freshAssetCount} / ${location.assetCount}` : null}
          hint="Telemetry freshness window"
        />
        <KpiTile
          label="Open alarms"
          status={kpiStatus}
          value={location ? String(location.openAlarms) : null}
          hint="Unacknowledged rows"
        />
        <KpiTile
          label="Critical alarms"
          status={kpiStatus}
          value={location ? String(location.criticalAlarms) : null}
          tone={location && location.criticalAlarms > 0 ? "critical" : "default"}
          hint="Open critical rows"
        />
        <KpiTile
          label="Open work orders"
          status={kpiStatus}
          value={location ? String(location.workOrdersOpen) : null}
          hint="Non-closed work orders"
        />
        <KpiTile
          label="RTUs"
          status={kpiStatus}
          value={location ? String(location.rtuCount) : null}
          hint="Gateways and domain simulators"
        />
      </div>
      {location?.scopeLabel === "partial" ? (
        <p className="text-[11px] text-bms-muted">
          Partial scope: these figures and panels cover only the assets in your asset groups.
        </p>
      ) : null}

      {viewQuery.isError ? (
        <p role="alert" className="text-sm text-red-600">
          Could not load the site view.
        </p>
      ) : view === undefined ? (
        <p className="text-sm text-bms-muted">Loading the site view…</p>
      ) : view.domains.length === 0 ? (
        <SectionCard bodyClassName="p-4">
          <p className="text-sm text-bms-muted">No assets in your access scope at this site.</p>
        </SectionCard>
      ) : (
        view.domains.map((domain) => (
          <SectionCard
            key={domain.code}
            title={domain.label}
            subtitle={`${domain.assets.length} ${domain.assets.length === 1 ? "asset" : "assets"}`}
            bodyClassName="p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {domain.assets.map((asset) => (
                <GeneratedSiteAssetCard key={asset.id} asset={asset} readings={readings} />
              ))}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
}
