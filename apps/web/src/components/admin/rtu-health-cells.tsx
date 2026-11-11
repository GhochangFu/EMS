import { CLOCK_SKEW_HIGHLIGHT_SECONDS } from "@bms/shared";
import type { RtuHealthDto } from "@bms/shared";

import {
  RTU_HEALTH_LABELS,
  RTU_HEALTH_TONES,
  absoluteTime,
  clockSkewHighlighted,
  clockSkewText,
  dropsSummary,
  lastSeenRelative,
} from "../../lib/device-health-format";
import { StatusPill } from "../status-pill";

/**
 * `F3.16` / ADR 0127 decisions 4, 16, 18 and 20 — the four device-health row
 * cells of the admin RTUs page. Split from `rtus-page.tsx` so the page stays a
 * list; the header tiles are `device-health-tiles.tsx` and the banner
 * `ingest-host-banner.tsx` (§4.2, one exported component per file).
 *
 * `health` is `undefined` while the read is pending, when it failed, or when
 * the RTU is not in its answer: every cell then reads "—" and the row keeps
 * working. Device-supplied strings are React text, never HTML (decision 8).
 */

const DASH = <span className="text-ink-muted">—</span>;

/** The Last seen, State, Clock skew and Drops 24 h cells of one RTU row. */
export function RtuHealthCells({
  code,
  health,
  nowMs,
  onOpenDrops,
}: {
  code: string;
  health: RtuHealthDto | undefined;
  nowMs: number;
  onOpenDrops: () => void;
}) {
  if (health === undefined) {
    return (
      <>
        <td className="px-2 py-2">{DASH}</td>
        <td className="px-2 py-2">{DASH}</td>
        <td className="px-2 py-2">{DASH}</td>
        <td className="px-2 py-2">{DASH}</td>
      </>
    );
  }
  const monitored = health.state !== "not_monitored";
  const skewHigh = clockSkewHighlighted(health.clockSkewSeconds);
  const drops = dropsSummary(health.drops24h);
  return (
    <>
      <td className="px-2 py-2 whitespace-nowrap">
        {monitored ? (
          <span title={health.lastSeenAt !== null ? absoluteTime(health.lastSeenAt) : undefined}>
            {lastSeenRelative(health.lastSeenAt, nowMs)}
          </span>
        ) : (
          DASH
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1">
          <StatusPill label={RTU_HEALTH_LABELS[health.state]} tone={RTU_HEALTH_TONES[health.state]} />
          {health.edgeServed ? (
            <span title="Served by an edge gateway: last seen lags by design and raises no comms-loss alarm">
              <StatusPill label="Edge" tone="info" />
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 whitespace-nowrap font-mono">
        {monitored && health.clockSkewSeconds !== null ? (
          <span
            className={skewHigh ? "font-semibold text-warning-ink" : undefined}
            title={skewHigh ? `Clock skew beyond ±${CLOCK_SKEW_HIGHLIGHT_SECONDS} s` : undefined}
          >
            {clockSkewText(health.clockSkewSeconds)}
          </span>
        ) : (
          DASH
        )}
      </td>
      <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
        {monitored ? (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-label={`Drop history for ${code}`}
              className="self-start font-mono text-xs font-semibold text-accent-strong"
              onClick={onOpenDrops}
            >
              {drops.total}
            </button>
            {drops.first !== null ? (
              <span className="text-2xs text-ink-muted">First: {drops.first}</span>
            ) : null}
          </div>
        ) : (
          DASH
        )}
      </td>
    </>
  );
}
