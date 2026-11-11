import { type DropReason, INGEST_HOST_STALE_SECONDS } from "@bms/shared/ingest";

import type { EdgeServed } from "./binding-targets.js";
import type { EndpointPlan } from "./bindings.js";
import { cleanLabel, type DropTallies, type DropTally, type ResolveResult } from "./normaliser.js";

/**
 * The device-health accumulator (`F3.16`, ADR 0127 decisions 9, 10, 16 and 17).
 *
 * **Pure.** No database, no timer, no `process`: the clock is injected, so the
 * heartbeat rule and the hour buckets are asserted in `device-health.spec.ts`
 * without waiting. `main.ts` owns the timer and `device-health-write.ts` the
 * SQL; this module only decides what the next flush carries.
 *
 * Lifecycle: `record` after every **successful** write (never before it — a
 * failed write is spilled and replayed, and counting it at the first attempt
 * would count it twice); `planChanged` at boot and on each reload; every
 * `INGEST_HEALTH_FLUSH_MS`, `drain` and write, then `committed` on success or
 * `restore` on failure.
 */

/** A restored bucket older than this many hours is discarded (bounded memory through a long outage). */
export const RESTORE_MAX_HOURS = 24;

const HOUR_MS = 3_600_000;
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;
/** `bms.ingest_endpoint_drop_hours.endpoint_key` is `varchar(255)`. */
const MAX_ENDPOINT_KEY_CHARS = 255;

/** The whole UTC hour `at` falls in — the bucket (migration `0149` CHECKs a whole hour). */
export function hourOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Every RTU the host serves under a plan: each cloud endpoint's bindings and
 * each edge gateway's RTUs (ADR 0127 decision 18 — edge-served RTUs get
 * last-seen and state too). What `planChanged` is fed at boot and on reload.
 */
export function monitoredRtuIds(
  endpoints: readonly Pick<EndpointPlan, "bindings">[],
  edgeServed: EdgeServed,
): string[] {
  const ids = endpoints.flatMap((endpoint) => endpoint.bindings.map((binding) => binding.rtuId));
  for (const gateway of edgeServed.values()) {
    ids.push(...gateway.rtuIdByDeviceKey.values());
  }
  return ids;
}

/** What one write produced, for one endpoint or one gateway. */
export type HealthRecord = {
  /** The endpoint (`plan.endpointKey`) or `edge:<gateway id>`; the key unattributed drops are counted under. */
  readonly endpointKey: string;
  /** The plan's `deviceKey → rtuId`. A key it does not map records nothing. */
  readonly rtuIdOf: (deviceKey: string) => string | undefined;
  readonly result: Pick<ResolveResult, "devices" | "unattributed">;
};

export type RtuActivityRow = {
  readonly rtuId: string;
  readonly lastSeenAt: Date;
  /** `device_time − receive time` in whole seconds, positive when the device is ahead; clamped to int4. */
  readonly clockSkewSeconds: number | null;
  /** The receive time of the sample the skew was taken from. */
  readonly clockSkewAt: Date | null;
};

export type RtuDropRow = {
  readonly rtuId: string;
  readonly bucket: Date;
  readonly reason: DropReason;
  readonly dropped: number;
  readonly firstAssetId: string | null;
  readonly firstPointKey: string | null;
  readonly firstSourceKey: string | null;
};

export type EndpointDropRow = {
  readonly endpointKey: string;
  readonly bucket: Date;
  readonly reason: DropReason;
  readonly dropped: number;
  readonly firstDeviceKey: string | null;
  readonly firstSourceKey: string | null;
};

/**
 * The host row's beat. Every instant the row stores (`started_at`,
 * `healthy_since`, `last_beat_at`) is the database's `now()`, not this host's
 * clock, because the API judges the beat against the database clock; the flags
 * say which of them this beat restarts.
 */
export type HostBeat = {
  readonly hostKey: string;
  /** This host's clock at the drain: the accumulator's missed-beat reference only, never written. */
  readonly beatAt: Date;
  readonly endpoints: number;
  /** No beat of this process has committed yet: `started_at` and `healthy_since` restart. */
  readonly restarted: boolean;
  /** `healthy_since` restarts: at boot, or after no beat committed for more than `INGEST_HOST_STALE_SECONDS`. */
  readonly healthyReset: boolean;
};

/** What `monitored_since` must do in this flush. */
export type Monitoring = {
  /** RTUs that entered the plan, with the instant they did. */
  readonly entered: readonly { readonly rtuId: string; readonly since: Date }[];
  /** RTUs that left it: their `monitored_since` is cleared. */
  readonly exited: readonly string[];
  /**
   * The whole plan, on the first flush after boot only: every row this host
   * stamped that is not in it is cleared, which catches an RTU removed while
   * the host was down. `null` on every later flush.
   */
  readonly keep: readonly string[] | null;
};

export type HealthFlush = {
  readonly host: HostBeat;
  readonly rtus: readonly RtuActivityRow[];
  readonly monitoring: Monitoring;
  readonly drops: readonly RtuDropRow[];
  readonly endpointDrops: readonly EndpointDropRow[];
};

export type DeviceHealth = {
  record(input: HealthRecord): void;
  /** The RTUs the host now serves (cloud endpoints and edge gateways), and the endpoint count. */
  planChanged(rtuIds: Iterable<string>, endpoints: number): void;
  drain(): HealthFlush;
  /** The flush committed: its beat is the reference for the next missed-beat check, and its restart flags are spent. */
  committed(flush: HealthFlush): void;
  /** The flush failed: merge it back. Returns the drops discarded by the hour bound. */
  restore(flush: HealthFlush): { readonly discarded: number };
};

export type DeviceHealthOptions = {
  readonly hostKey: string;
  readonly now: () => Date;
};

/**
 * A gap since the last committed beat longer than this is a missed beat: the
 * API's host-stale bound, past which it froze every state, so the restart
 * credit is owed exactly when the states were frozen. One failed flush at
 * `INGEST_HEALTH_FLUSH_MS` (at most 15 s) stays inside it.
 */
const MISSED_BEAT_MS = INGEST_HOST_STALE_SECONDS * 1_000;

type Bucket = { dropped: number; first: DropTally["first"]; bucket: Date; reason: DropReason };

function skewSeconds(deviceTime: Date, receivedAt: Date): number {
  const seconds = Math.round((deviceTime.getTime() - receivedAt.getTime()) / 1_000);
  return Math.min(INT4_MAX, Math.max(INT4_MIN, seconds));
}

function cutEndpointKey(key: string): string {
  const points = Array.from(key);
  return points.length <= MAX_ENDPOINT_KEY_CHARS ? key : points.slice(0, MAX_ENDPOINT_KEY_CHARS).join("");
}

const SEP = "\u0000";

/** Adds `count` to the bucket; the first point is the earlier one's (the existing entry's). */
function addTo(map: Map<string, Bucket & { owner: string }>, owner: string, reason: DropReason, t: Bucket): void {
  const key = [owner, t.bucket.toISOString(), reason].join(SEP);
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, { ...t, owner });
  } else {
    existing.dropped += t.dropped;
  }
}

/**
 * The accumulator one ingest host keeps (ADR 0127 decisions 9, 10 and 17):
 * RTU activity, hour buckets of drops and the plan's `monitored_since` delta
 * between flushes, and the heartbeat's restart flags. `options.now` is the
 * only clock; see the module comment for the call order.
 */
export function createDeviceHealth(options: DeviceHealthOptions): DeviceHealth {
  const startedAt = options.now();
  let lastCommittedBeat: Date | undefined;
  let restartPending = true;
  let healthyResetPending = true;
  let endpoints = 0;

  let rtus = new Map<string, { lastSeenAt: Date; skew: { seconds: number; at: Date } | null }>();
  let drops = new Map<string, Bucket & { owner: string }>();
  let endpointDrops = new Map<string, Bucket & { owner: string }>();

  let plan: ReadonlySet<string> | undefined;
  let entered = new Map<string, Date>();
  let exited = new Set<string>();
  let keepDue = false;

  const mergeRtu = (rtuId: string, lastSeenAt: Date, skew: { seconds: number; at: Date } | null): void => {
    const current = rtus.get(rtuId);
    if (current === undefined) {
      rtus.set(rtuId, { lastSeenAt, skew });
      return;
    }
    if (lastSeenAt.getTime() > current.lastSeenAt.getTime()) {
      current.lastSeenAt = lastSeenAt;
    }
    if (skew !== null && (current.skew === null || skew.at.getTime() >= current.skew.at.getTime())) {
      current.skew = skew;
    }
  };

  const addTallies = (
    target: Map<string, Bucket & { owner: string }>,
    owner: string,
    tallies: DropTallies,
  ): void => {
    for (const [reason, tally] of Object.entries(tallies) as [DropReason, DropTally][]) {
      // Each drop lands in the hour of its own receive time (a replayed batch can cross one).
      for (const hour of tally.hours) {
        addTo(target, owner, reason, {
          dropped: hour.count,
          bucket: hourOf(hour.firstAt),
          reason,
          first: {
            assetId: hour.first.assetId,
            pointKey: cleanLabel(hour.first.pointKey),
            sourceKey: cleanLabel(hour.first.sourceKey),
            deviceKey: cleanLabel(hour.first.deviceKey),
          },
        });
      }
    }
  };

  return {
    record({ endpointKey, rtuIdOf, result }) {
      for (const [deviceKey, activity] of result.devices) {
        const rtuId = rtuIdOf(deviceKey);
        if (rtuId === undefined) {
          continue;
        }
        const skew =
          activity.skew === null
            ? null
            : { seconds: skewSeconds(activity.skew.deviceTime, activity.skew.receivedAt), at: activity.skew.receivedAt };
        mergeRtu(rtuId, activity.lastReceivedAt, skew);
        addTallies(drops, rtuId, activity.drops);
      }
      addTallies(endpointDrops, cutEndpointKey(endpointKey), result.unattributed);
    },

    planChanged(rtuIds, endpointCount) {
      const next = new Set(rtuIds);
      const at = options.now();
      endpoints = endpointCount;
      if (plan === undefined) {
        keepDue = true;
      }
      for (const rtuId of next) {
        if (plan?.has(rtuId) === true) {
          continue;
        }
        if (exited.delete(rtuId)) {
          // Left and came back before a flush: the stored stamp still stands.
          continue;
        }
        entered.set(rtuId, at);
      }
      for (const rtuId of plan ?? []) {
        if (!next.has(rtuId)) {
          entered.delete(rtuId);
          exited.add(rtuId);
        }
      }
      plan = next;
    },

    drain() {
      const now = options.now();
      const reference = lastCommittedBeat ?? startedAt;
      if (now.getTime() - reference.getTime() > MISSED_BEAT_MS) {
        healthyResetPending = true;
      }
      const flush: HealthFlush = {
        host: {
          hostKey: options.hostKey,
          beatAt: now,
          endpoints,
          restarted: restartPending,
          healthyReset: healthyResetPending,
        },
        rtus: [...rtus].map(([rtuId, r]) => ({
          rtuId,
          lastSeenAt: r.lastSeenAt,
          clockSkewSeconds: r.skew?.seconds ?? null,
          clockSkewAt: r.skew?.at ?? null,
        })),
        monitoring: {
          entered: [...entered].map(([rtuId, since]) => ({ rtuId, since })),
          exited: [...exited],
          keep: keepDue && plan !== undefined ? [...plan] : null,
        },
        drops: [...drops.values()].map((b) => ({
          rtuId: b.owner,
          bucket: b.bucket,
          reason: b.reason,
          dropped: b.dropped,
          firstAssetId: b.first.assetId,
          firstPointKey: b.first.pointKey,
          firstSourceKey: b.first.sourceKey,
        })),
        endpointDrops: [...endpointDrops.values()].map((b) => ({
          endpointKey: b.owner,
          bucket: b.bucket,
          reason: b.reason,
          dropped: b.dropped,
          firstDeviceKey: b.first.deviceKey,
          firstSourceKey: b.first.sourceKey,
        })),
      };
      rtus = new Map();
      drops = new Map();
      endpointDrops = new Map();
      entered = new Map();
      exited = new Set();
      keepDue = false;
      return flush;
    },

    committed(flush) {
      lastCommittedBeat = flush.host.beatAt;
      if (flush.host.restarted) restartPending = false;
      if (flush.host.healthyReset) healthyResetPending = false;
    },

    restore(flush) {
      const cutoff = hourOf(options.now()).getTime() - RESTORE_MAX_HOURS * HOUR_MS;
      let discarded = 0;
      for (const r of flush.rtus) {
        mergeRtu(r.rtuId, r.lastSeenAt, r.clockSkewAt === null || r.clockSkewSeconds === null
          ? null
          : { seconds: r.clockSkewSeconds, at: r.clockSkewAt });
      }
      // Re-inserted in front of anything recorded since, so the restored
      // (earlier) first point wins: rebuild each map restored-first.
      const restoreInto = (
        current: Map<string, Bucket & { owner: string }>,
        rows: readonly (Bucket & { owner: string })[],
      ): Map<string, Bucket & { owner: string }> => {
        const merged = new Map<string, Bucket & { owner: string }>();
        for (const row of rows) {
          if (row.bucket.getTime() < cutoff) {
            discarded += row.dropped;
            continue;
          }
          addTo(merged, row.owner, row.reason, row);
        }
        for (const row of current.values()) {
          addTo(merged, row.owner, row.reason, row);
        }
        return merged;
      };
      drops = restoreInto(
        drops,
        flush.drops.map((d) => ({
          owner: d.rtuId,
          bucket: d.bucket,
          reason: d.reason,
          dropped: d.dropped,
          first: { assetId: d.firstAssetId, pointKey: d.firstPointKey, sourceKey: d.firstSourceKey, deviceKey: null },
        })),
      );
      endpointDrops = restoreInto(
        endpointDrops,
        flush.endpointDrops.map((d) => ({
          owner: d.endpointKey,
          bucket: d.bucket,
          reason: d.reason,
          dropped: d.dropped,
          first: { assetId: null, pointKey: null, sourceKey: d.firstSourceKey, deviceKey: d.firstDeviceKey },
        })),
      );
      // The plan may have moved on since the drain: restore only what still holds.
      for (const { rtuId, since } of flush.monitoring.entered) {
        if (plan?.has(rtuId) === true && !entered.has(rtuId)) {
          entered.set(rtuId, since);
        }
      }
      for (const rtuId of flush.monitoring.exited) {
        if (plan?.has(rtuId) !== true) {
          exited.add(rtuId);
        }
      }
      if (flush.monitoring.keep !== null) {
        keepDue = true;
      }
      return { discarded };
    },
  };
}
