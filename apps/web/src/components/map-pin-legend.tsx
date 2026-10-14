import type { MapSiteDto } from "@bms/shared";

import { MAP_PIN_ROLES } from "../lib/map-site";
import type { RoleName } from "../lib/theme";

type PinStatus = MapSiteDto["live"]["status"];

/** One legend line per pin status, in reading order. */
const ENTRIES: ReadonlyArray<{ status: PinStatus; label: string }> = [
  { status: "healthy", label: "Live" },
  { status: "warning", label: "Warning alarm" },
  { status: "critical", label: "Critical alarm" },
  { status: "offline", label: "Not live" },
  { status: "unknown", label: "No assets or status" },
  { status: "nominal", label: "Reference station" },
];

/** Literal classes, so Tailwind generates them; keyed by the roles `MAP_PIN_ROLES` uses. */
const SWATCH: Partial<Record<RoleName, string>> = {
  accent: "bg-accent",
  warning: "bg-warning",
  critical: "bg-critical",
  "ink-faint": "bg-ink-faint",
  "ink-muted": "bg-ink-muted",
  "accent-strong": "bg-accent-strong",
};

/**
 * `F4.262` — the key to the Sites map's pin colours, one line per pin status, each swatch the role
 * `MAP_PIN_ROLES` gives that status — the table the pins are drawn from. An alarm colours a pin
 * before its telemetry does, so the note says how the strip counts such a pin.
 */
export function MapPinLegend() {
  return (
    <div className="space-y-1">
      <ul
        data-testid="map-pin-legend"
        aria-label="Map pin colours"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted"
      >
        {ENTRIES.map((entry) => (
          <li key={entry.status} data-status={entry.status} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-flex h-2.5 w-2.5 rounded-full ${SWATCH[MAP_PIN_ROLES[entry.status]] ?? ""}`}
            />
            {entry.label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        An alarm colours a pin first: a site with an alarm and no fresh telemetry counts as not live.
      </p>
    </div>
  );
}
