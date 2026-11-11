import { INGEST_HOST_STALE_SECONDS, STALE_BAND_FRACTION } from "@bms/shared";
import type { IngestHostState, RtuHealthState } from "@bms/shared";

/**
 * `F3.16` / ADR 0127 decisions 11 and 16 — the one state rule for an RTU and
 * for the ingest host. Pure: SQL supplies the fields (as epoch milliseconds),
 * this file judges them, so the RTUs page, system status, the worker sweep and
 * the lifecycle clear (PR B) cannot disagree.
 *
 * **The reference is the serving host's last beat, never the wall clock.** A
 * stopped host freezes every RTU's state (decision 6 by construction), and a
 * restart (`healthy_since`), a newly enabled RTU (`monitored_since`) or a
 * missed beat each give one full window before an RTU can read Offline.
 */

/** One `bms.ingest_hosts` row, as the readers load it. */
export interface HostBeat {
  readonly hostKey: string;
  readonly lastBeatMs: number;
  /** `null` after a missed beat (decision 10): no restart credit. */
  readonly healthySinceMs: number | null;
}

/** One RTU's `bms.rtu_health` fields; all `null` for an RTU with no row. */
export interface RtuHealthFacts {
  readonly hostKey: string | null;
  readonly lastSeenMs: number | null;
  readonly monitoredSinceMs: number | null;
}

/**
 * `age = host.last_beat_at - greatest(last_seen_at, monitored_since, host.healthy_since)`;
 * Online at `age <= 0.6 W`, Stale at `age <= W`, Offline past it. An RTU with no
 * `monitored_since` (the host does not serve it: a simulator or catalog RTU,
 * decision 20) or whose host has no row (no beat to judge against) is Not monitored.
 */
export function rtuStateAt(
  rtu: RtuHealthFacts,
  host: HostBeat | undefined,
  windowSeconds: number,
): RtuHealthState {
  if (rtu.monitoredSinceMs === null || host === undefined) {
    return "not_monitored";
  }
  const reference = Math.max(rtu.monitoredSinceMs, rtu.lastSeenMs ?? -Infinity, host.healthySinceMs ?? -Infinity);
  const ageSeconds = (host.lastBeatMs - reference) / 1000;
  if (ageSeconds <= STALE_BAND_FRACTION * windowSeconds) {
    return "online";
  }
  return ageSeconds <= windowSeconds ? "stale" : "offline";
}

/** The host is stale strictly after {@link INGEST_HOST_STALE_SECONDS} with no beat, judged on the database clock. */
export function hostStateAt(host: HostBeat | undefined, dbNowMs: number): IngestHostState {
  if (host === undefined) {
    return "never";
  }
  return (dbNowMs - host.lastBeatMs) / 1000 > INGEST_HOST_STALE_SECONDS ? "stale" : "ok";
}

const SEVERITY: Record<IngestHostState, number> = { ok: 0, stale: 1, never: 2 };

/**
 * One host state for a set of RTUs: the hosts their `host_key`s name, or every
 * host when they name none (no RTU of the caller is served yet). The worst state
 * wins (`never` > `stale` > `ok`), and `lastBeatMs` is the oldest beat at that state.
 */
export function hostSummaryFor(
  hosts: readonly HostBeat[],
  servingHostKeys: readonly string[],
  dbNowMs: number,
): { state: IngestHostState; lastBeatMs: number | null } {
  const byKey = new Map(hosts.map((h) => [h.hostKey, h]));
  const relevant: (HostBeat | undefined)[] =
    servingHostKeys.length > 0 ? [...new Set(servingHostKeys)].map((key) => byKey.get(key)) : [...hosts];
  let worst: { state: IngestHostState; lastBeatMs: number | null } = { state: "never", lastBeatMs: null };
  let seen = false;
  for (const host of relevant) {
    const state = hostStateAt(host, dbNowMs);
    const lastBeatMs = host?.lastBeatMs ?? null;
    const worse =
      !seen ||
      SEVERITY[state] > SEVERITY[worst.state] ||
      (state === worst.state && lastBeatMs !== null && worst.lastBeatMs !== null && lastBeatMs < worst.lastBeatMs);
    if (worse) {
      worst = { state, lastBeatMs };
      seen = true;
    }
  }
  return worst;
}
