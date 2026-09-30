import type { MapSiteDto } from "@bms/shared";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";

import { siteAssetsPath } from "../lib/smoc-pages";
import type { RoleName } from "../lib/theme";
import { isOperationalSite, MAP_TILE, siteBounds } from "../lib/map-site";
import { useThemeRoles } from "../stores/theme-store";

/**
 * `F4.163` — opens the map on the caller's own sites, once. The sites query
 * refetches every few seconds, so fitting on every change would undo the
 * user's pan and zoom; the first non-empty list decides and later ones do not.
 */
function FitToSites({ sites }: { sites: MapSiteDto[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) {
      return;
    }
    const bounds = siteBounds(sites);
    if (bounds === null) {
      return;
    }
    fitted.current = true;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 10 });
  }, [map, sites]);
  return null;
}

/**
 * `F3.65c` — the marker fill role, not a hex (ADR 0078 decision 5, plan D4).
 * `nominal` reads `accent-strong` per OQ5, the same call the electrical-SLD
 * flow dashes make for the mockup's second, brighter green.
 */
function markerRole(site: MapSiteDto): RoleName {
  switch (site.live.status) {
    case "healthy":
      return "accent";
    case "warning":
      return "warning";
    case "critical":
      return "critical";
    case "offline":
      return "ink-faint";
    case "nominal":
      return "accent-strong";
    default:
      return "ink-muted";
  }
}

type WorldMapProps = {
  sites: MapSiteDto[];
};

export function WorldMap({ sites }: WorldMapProps) {
  const roles = useThemeRoles();
  return (
    <MapContainer
      center={[-29, 24.5]}
      zoom={5}
      className="z-0 h-[min(70vh,560px)] w-full surface-pressed"
      scrollWheelZoom
    >
      <TileLayer attribution={MAP_TILE.attribution} url={MAP_TILE.url} maxZoom={MAP_TILE.maxZoom} />
      <FitToSites sites={sites} />
      {sites.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.latitude, s.longitude]}
          radius={isOperationalSite(s) ? 12 : 7}
          pathOptions={{
            color: roles.chrome,
            weight: 2,
            fillColor: roles[markerRole(s)],
            fillOpacity: 0.92,
          }}
        >
          <Popup>
            <div className="min-w-[210px] text-ink">
              <div className="font-condensed text-sm font-bold">{s.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-muted">
                <span data-testid="site-kind">{s.kindLabel}</span>
                {s.organization ? ` · ${s.organization.code}` : ""} ·{" "}
                <span className="font-mono">{s.live.status}</span>
              </div>
              {s.kind === "eskom_station" ? (
                <dl className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Capacity</dt>
                    <dd className="font-mono">
                      {s.capacityMw != null ? s.capacityMw.toLocaleString() : "—"} MW
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Type</dt>
                    <dd>{s.stationType ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Province</dt>
                    <dd>{s.province ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <dl className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Open alarms</dt>
                    <dd className="font-mono">{s.live.openAlarms}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Critical</dt>
                    <dd className="font-mono">{s.live.criticalAlarms}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Telemetry fresh</dt>
                    <dd className="font-mono">
                      {s.live.assetsFresh}/{s.live.assetsTotal} assets
                    </dd>
                  </div>
                </dl>
              )}
              <div className="mt-2 flex flex-wrap gap-3 border-t border-line pt-2">
                <Link className="text-xs font-semibold text-accent-strong hover:underline" to="/alarms">
                  Alarm Centre →
                </Link>
                <Link
                  className="text-xs font-semibold text-accent-strong hover:underline"
                  to={
                    // `F3.72` (OQ9) — straight to the site's Assets & RTUs tab.
                    s.canonicalLocationId ? siteAssetsPath(s.canonicalLocationId) : "/"
                  }
                >
                  Dashboard →
                </Link>
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
