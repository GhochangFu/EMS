import type { MapSiteDto } from "@bms/shared";
import { Link } from "react-router-dom";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import "leaflet/dist/leaflet.css";

const TILE = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
};

function markerColor(site: MapSiteDto): string {
  switch (site.live.status) {
    case "healthy":
      return "#00A651";
    case "warning":
      return "#DC6803";
    case "critical":
      return "#D92D20";
    case "offline":
      return "#7A8494";
    case "nominal":
      return "#3DCD58";
    default:
      return "#4A5464";
  }
}

function isOperationalLocation(site: MapSiteDto): boolean {
  return (
    site.kind === "smoc_campus" ||
    site.kind === "rsmoc" ||
    site.kind === "csmoc"
  );
}

function locationKindLabel(site: MapSiteDto): string {
  switch (site.kind) {
    case "smoc_campus":
      return "SMOC campus";
    case "rsmoc":
      return "RSMOC";
    case "csmoc":
      return "CSMOC";
    case "eskom_station":
      return "Eskom station";
  }
}

type WorldMapProps = {
  sites: MapSiteDto[];
};

export function WorldMap({ sites }: WorldMapProps) {
  return (
    <MapContainer
      center={[-29, 24.5]}
      zoom={5}
      className="z-0 h-[min(70vh,560px)] w-full rounded-lg border border-gray-800 shadow-inner"
      scrollWheelZoom
    >
      <TileLayer attribution={TILE.attribution} url={TILE.url} />
      {sites.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.latitude, s.longitude]}
          radius={isOperationalLocation(s) ? 12 : 7}
          pathOptions={{
            color: "#1D2430",
            weight: 2,
            fillColor: markerColor(s),
            fillOpacity: 0.92,
          }}
        >
          <Popup>
            <div className="min-w-[210px] text-bms-ink">
              <div className="font-condensed text-sm font-bold">{s.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-bms-muted">
                {locationKindLabel(s)} ·{" "}
                <span className="font-mono">{s.live.status}</span>
              </div>
              {s.kind === "eskom_station" ? (
                <dl className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Capacity</dt>
                    <dd className="font-mono">
                      {s.capacityMw != null ? s.capacityMw.toLocaleString() : "—"} MW
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Type</dt>
                    <dd>{s.stationType ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Province</dt>
                    <dd>{s.province ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <dl className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Open alarms</dt>
                    <dd className="font-mono">{s.live.openAlarms}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Critical</dt>
                    <dd className="font-mono">{s.live.criticalAlarms}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-bms-muted">Telemetry fresh</dt>
                    <dd className="font-mono">
                      {s.live.assetsFresh}/{s.live.assetsTotal} assets
                    </dd>
                  </div>
                </dl>
              )}
              <div className="mt-2 flex flex-wrap gap-3 border-t border-gray-200 pt-2">
                <Link className="text-xs font-semibold text-bms-green hover:underline" to="/alarms">
                  Alarm Centre →
                </Link>
                <Link
                  className="text-xs font-semibold text-bms-green hover:underline"
                  to={
                    s.canonicalLocationId
                      ? `/locations/${s.canonicalLocationId}/dashboard`
                      : "/"
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
