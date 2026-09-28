import type { LocationKpiSummary } from "@bms/shared";
import { Link } from "react-router-dom";

type LocationKpiCardProps = {
  location: LocationKpiSummary;
  /**
   * `F3.66` (plan D4) — where the card links. Defaults to the location
   * dashboard, which `/` and the accordion keep; the Control Room organization
   * overview passes `/control-room/site/:id`.
   */
  to?: string;
};

/** Clickable location KPI card for the executive dashboard and the Control Room. */
export function LocationKpiCard({ location, to }: LocationKpiCardProps) {
  const hasLiveTelemetry = location.freshAssetCount > 0;

  return (
    <Link
      to={to ?? `/locations/${location.id}/dashboard`}
      className={`relative z-0 block w-full min-w-0 rounded-lg border bg-surface p-3 shadow-sm transition hover:z-10 hover:border-accent hover:shadow-md ${
        hasLiveTelemetry ? "border-accent/20" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-condensed text-base font-bold text-ink">
            {location.name}
          </div>
          <div className="text-xs uppercase tracking-wide text-ink-muted">
            {location.organization.code} · {location.province ?? location.typeLabel} ·{" "}
            {location.scopeLabel === "partial" ? "partial scope" : "full scope"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded bg-canvas px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-ink">
            {location.organization.code}
          </span>
          <span className="rounded bg-ok-wash px-2 py-1 text-xs font-semibold text-ok-ink">
            {location.rtuCount} RTUs · {location.assetCount} assets
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              hasLiveTelemetry
                ? "bg-ok-wash text-ok-ink"
                : "bg-well-deep text-ink-muted"
            }`}
          >
            {hasLiveTelemetry ? "Live telemetry" : "No live telemetry"}
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="font-mono text-sm font-semibold text-ink">
            {location.totalKw.toFixed(1)}
          </div>
          <div className="text-ink-muted">kW</div>
        </div>
        <div>
          <div
            className={`font-mono text-sm font-semibold ${
              hasLiveTelemetry ? "text-ok-ink" : "text-ink"
            }`}
          >
            {location.freshAssetCount}/{location.assetCount}
          </div>
          <div className="text-ink-muted">fresh</div>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold text-ink">
            {location.openAlarms}
          </div>
          <div className="text-ink-muted">alarms</div>
        </div>
      </div>
    </Link>
  );
}
