import { CLOCK_SKEW_HIGHLIGHT_SECONDS } from "@bms/shared";
import type { DeviceHealthResponse, RtuHealthDto } from "@bms/shared";

import {
  INGEST_HOST_BANNER,
  RTU_HEALTH_LABELS,
  RTU_HEALTH_TONES,
  absoluteTime,
  clockSkewHighlighted,
  clockSkewText,
  deviceHealthCounts,
  dropsSummary,
  lastSeenRelative,
} from "../../lib/device-health-format";
import { KpiTile, type KpiTileStatus } from "../kpi-tile";
import { StatusPill } from "../status-pill";

/**
 * `F3.16` / ADR 0127 decisions 4, 16, 18 and 20 — the device-health parts of
 * the admin RTUs page: four row cells, the header tiles and the ingest-host
 * banner. Split from `rtus-page.tsx` so the page stays a list.
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

/** Monitored / Online / Stale / Offline over the RTUs the read answered for (decision 19). */
export function DeviceHealthTiles({
  data,
  status,
}: {
  data: DeviceHealthResponse | undefined;
  status: KpiTileStatus;
}) {
  const counts = data ? deviceHealthCounts(data.items) : null;
  const value = (n: number | undefined) => (n === undefined ? null : String(n));
  return (
    <section aria-label="Device health" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile label="Monitored" status={status} value={value(counts?.monitored)} />
      <KpiTile label="Online" status={status} value={value(counts?.online)} />
      <KpiTile
        label="Stale"
        status={status}
        value={value(counts?.stale)}
        tone={counts && counts.stale > 0 ? "warning" : "default"}
      />
      <KpiTile
        label="Offline"
        status={status}
        value={value(counts?.offline)}
        tone={counts && counts.offline > 0 ? "critical" : "default"}
      />
    </section>
  );
}

/**
 * The banner while the ingest host is not reporting (decision 16). Shown only
 * when a monitored RTU is in the answer: with none, nothing is frozen, and a
 * simulator-only estate (decision 20) has no host to report.
 */
export function IngestHostBanner({ data }: { data: DeviceHealthResponse | undefined }) {
  if (!data || data.ingestHost.state === "ok") return null;
  if (deviceHealthCounts(data.items).monitored === 0) return null;
  return (
    <p
      role="status"
      className="rounded border border-warning-line bg-warning-wash p-3 text-sm text-warning-ink"
      title={data.ingestHost.lastBeatAt !== null ? `Last heartbeat ${absoluteTime(data.ingestHost.lastBeatAt)}` : undefined}
    >
      {INGEST_HOST_BANNER}
    </p>
  );
}
