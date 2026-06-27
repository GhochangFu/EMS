import type { LocationKpiSummary } from "@bms/shared";
import { Link } from "react-router-dom";

type LocationKpiCardProps = {
  location: LocationKpiSummary;
};

/** Clickable location KPI card for the executive dashboard. */
export function LocationKpiCard({ location }: LocationKpiCardProps) {
  const hasLiveTelemetry = location.freshAssetCount > 0;

  return (
    <Link
      to={`/locations/${location.id}/dashboard`}
      className={`relative z-0 block w-full min-w-0 rounded-lg border bg-white p-3 shadow-sm transition hover:z-10 hover:border-bms-green hover:shadow-md ${
        hasLiveTelemetry ? "border-emerald-300" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-condensed text-base font-bold text-bms-ink">
            {location.name}
          </div>
          <div className="text-xs uppercase tracking-wide text-bms-muted">
            {location.organization.code} · {location.province ?? location.type} ·{" "}
            {location.scopeLabel === "partial" ? "partial scope" : "full scope"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
            {location.organization.code}
          </span>
          <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
            {location.rtuCount} RTUs · {location.assetCount} assets
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
}
