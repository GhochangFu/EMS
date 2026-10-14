import type { LocationKpiSummary } from "@bms/shared";
import { Link } from "react-router-dom";

import { hasLiveTelemetry } from "../lib/location-kpi-groups";

type LocationKpiCardProps = {
  location: LocationKpiSummary;
  /**
   * `F3.66` (plan D4) — where the card links. Defaults to the Control Room
   * site view (`F3.72` OQ7), which the estate accordion and the organization
   * overview both open; pass `to` only for another target.
   */
  to?: string;
};

/**
 * Clickable location KPI card for the executive dashboard and the Control Room.
 *
 * `F4.259` — whether the site is live is the first thing the card shows: a green left edge and
 * a Live badge with a pulsing dot, or an amber edge and a Not live badge with a hollow dot (amber,
 * not red: red stays for alarms). A card that is not live mutes its kW figure.
 */
export function LocationKpiCard({ location, to }: LocationKpiCardProps) {
  const live = hasLiveTelemetry(location);

  return (
    <Link
      to={to ?? `/control-room/site/${location.id}`}
      data-live={live ? "true" : "false"}
      className={`relative z-0 block w-full min-w-0 surface-raised border-l-4 p-3 transition hover:z-10 hover:ring-2 hover:ring-accent/40 ${
        live ? "border-l-accent" : "border-l-warning"
      }`}
    >
      <LiveBadge live={live} />
      <div className="mt-2 flex items-start justify-between gap-3">
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
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div
            className={`font-mono text-sm font-semibold ${live ? "text-ink" : "text-ink-muted"}`}
          >
            {location.totalKw.toFixed(1)}
          </div>
          <div className="text-ink-muted">kW</div>
        </div>
        <div>
          <div
            className={`font-mono text-sm font-semibold ${
              live ? "text-ok-ink" : "text-warning-ink"
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

/** `F4.259` — the card's status badge. The dots are decoration; the word carries the state. */
function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      data-testid="site-live-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
        live ? "bg-ok-wash text-ok-ink" : "bg-warning-wash text-warning-ink"
      }`}
    >
      {live ? (
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
      ) : (
        <span aria-hidden className="inline-flex h-2 w-2 rounded-full border-2 border-warning" />
      )}
      {live ? "Live" : "Not live"}
    </span>
  );
}
