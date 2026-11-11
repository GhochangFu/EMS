import {
  type SourceSample,
  UPLINK_MAX_AGE_MS,
  UPLINK_MAX_FUTURE_MS,
  type UplinkBatch,
  type UplinkResponse,
} from "@bms/shared/ingest";

import type { EdgeServed } from "./binding-targets.js";
import type { HealthRecord } from "./device-health.js";
import type { HostLogger } from "./logger.js";
import {
  droppedCount,
  type PointIndex,
  type QueryableClient,
  resolveSamples,
  type WriteResult,
} from "./normaliser.js";
import type { ReceivedSample } from "./received-sample.js";
import type { GatewayRecord } from "./uplink-gateways.js";
import { writeUplinkRows } from "./uplink-write.js";

/**
 * The uplink receiver's batch handling (`E7.2`, ADR 0123 decisions 4, 5 and 8,
 * plan T3.2).
 *
 * A batch from an authenticated gateway is screened here, then fed to the same
 * `resolveSamples` → `writeResolved` path the supervisor uses. Screening is
 * pure: no clock of its own, no database.
 *
 * **Three guards, in a fixed order, each counted and none refusing the batch**
 * — one bad sample must never block a gateway's queue for ever (decision 8),
 * so the batch still answers `200` with the counts:
 *
 * 1. `foreignDevice` — the `deviceKey` is not one of the calling gateway's
 *    RTUs (decision 5, the `F1.7` topic-binding rule on a new transport). The
 *    sample is dropped and never resolved, so a token cannot write another
 *    gateway's or the cloud's own RTUs. A box deployed before its RTUs are
 *    assigned has every sample counted here (ruling P10 (a): assign first).
 * 2. `futureRx` — `rx` more than `UPLINK_MAX_FUTURE_MS` (60 s) ahead of this
 *    host's clock. A row at a future `time` reads as fresh to every recency
 *    window until the clock catches up.
 * 3. `tooOld` — `rx` more than `UPLINK_MAX_AGE_MS` (6 d 12 h) behind it, which
 *    keeps a backlog out of compressed chunks (ADR 0123 F3).
 *
 * Both bounds are inclusive: a sample exactly at either passes.
 */

/** The three screening reasons. `unresolved` is `resolveSamples`'s, counted later. */
export type ScreenCounts = {
  foreignDevice: number;
  futureRx: number;
  tooOld: number;
};

export type ScreenResult = {
  /** Samples that passed, with `rx` as their receive time. */
  readonly samples: readonly ReceivedSample[];
  readonly rejected: ScreenCounts;
};

/**
 * Screens one batch against the calling gateway's device keys and `now`.
 *
 * `rx` becomes `receivedAt` **unchanged**: for an edge sample the receive time
 * is its arrival at the edge (ADR 0061 Amendment 4), and that is what keeps a
 * retried batch on the same primary key (decision 8). `at` is kept as the
 * device's claim and becomes `device_time`; an absent `at` stays absent.
 */
export function screenBatch(batch: UplinkBatch, deviceKeys: ReadonlySet<string>, now: Date): ScreenResult {
  const rejected: ScreenCounts = { foreignDevice: 0, futureRx: 0, tooOld: 0 };
  const samples: ReceivedSample[] = [];
  const nowMs = now.getTime();

  for (const wire of batch.samples) {
    if (!deviceKeys.has(wire.deviceKey)) {
      rejected.foreignDevice += 1;
      continue;
    }
    const receivedAt = new Date(wire.rx);
    const rxMs = receivedAt.getTime();
    if (rxMs - nowMs > UPLINK_MAX_FUTURE_MS) {
      rejected.futureRx += 1;
      continue;
    }
    if (nowMs - rxMs > UPLINK_MAX_AGE_MS) {
      rejected.tooOld += 1;
      continue;
    }
    const sample: SourceSample = {
      sourceKey: wire.sourceKey,
      value: wire.value,
      deviceKey: wire.deviceKey,
      ...(wire.at === undefined ? {} : { at: new Date(wire.at) }),
      ...(wire.good === undefined ? {} : { good: wire.good }),
    };
    samples.push({ sample, receivedAt });
  }

  return { samples, rejected };
}

/**
 * The slice of a pooled `pg` client the receiver needs. `release(error)`
 * destroys the connection rather than returning it to the pool — what a
 * timed-out or failed write must do, since the statement may still be running
 * on it.
 */
export type ReceiverClient = QueryableClient & { release(error?: Error): void };

/**
 * How long one uplink write may take before the listener answers `503`
 * (security review L1). The supervisor's `writeTimeoutMs` (30 s) is too long
 * here: the edge aborts a post at 20 s (plan C4), so the receiver must give up
 * first and release its connection, or a stalled database holds one pool
 * client per gateway per retry.
 */
export const UPLINK_WRITE_TIMEOUT_MS = 15_000;

/** At most one "uplink samples rejected" line per gateway per this many ms. */
export const REJECTED_LOG_INTERVAL_MS = 60_000;

export type UplinkReceiverDeps = {
  /** This host's clock: the screening bound, the live window and `last_seen_at`. */
  readonly now: () => Date;
  /** The latest binding plan's edge-served map; swapped by `main.ts` on each reload. */
  readonly edgeServed: () => EdgeServed;
  readonly connect: () => Promise<ReceiverClient>;
  readonly liveWindowMs: number;
  readonly logger: HostLogger;
  /**
   * `F3.16` (ADR 0127 decisions 9, 18): called once per batch, **after** the
   * write committed — a failed batch stays on the edge's disk and is retried,
   * so recording it at the first attempt would count it twice. Required: an
   * optional hook here would be a path that silently records nothing.
   */
  readonly recordHealth: (record: HealthRecord) => void;
  /** Defaults to `UPLINK_WRITE_TIMEOUT_MS`. */
  readonly writeTimeoutMs?: number;
};

/**
 * Accepts one authenticated batch; resolves to the `200` body, rejects on a
 * failed or timed-out write. `digest` is `AuthOutcome.digest`, which the
 * write binds its commit to.
 */
export type ReceiveBatch = (gateway: GatewayRecord, batch: UplinkBatch, digest: Buffer) => Promise<UplinkResponse>;

const NO_DEVICES: ReadonlySet<string> = new Set();
const NO_POINTS: PointIndex = new Map();

type Rejected = UplinkResponse["rejected"];

/** Thrown when a write outlives `writeTimeoutMs`; the listener answers 503. */
export class UplinkWriteTimeout extends Error {
  constructor(ms: number) {
    super(`uplink write exceeded ${ms} ms`);
    this.name = "UplinkWriteTimeout";
  }
}

/**
 * Builds the receiver: screen → `resolveSamples` → `writeUplinkRows`.
 *
 * Resolves only after the rows and the gateway report have committed, so a
 * `200` means stored (decision 4). A rejection is a failed write and the
 * listener answers `503` with `Retry-After` (ruling P1 (b)): the edge keeps
 * the batch on its own disk and retries, and nothing is spilled here. A write
 * that outlives `writeTimeoutMs` is abandoned and its client destroyed, so the
 * pool gets a fresh connection; the backend's own statement is cancelled by
 * the transaction's `SET LOCAL statement_timeout` (`uplink-write.ts`), not by
 * destroying the client.
 *
 * `deviceKey` is required on the wire, so there is no sole-device fallback:
 * `resolveSamples` gets `undefined` for it. A sample that resolves to no point
 * is counted `unresolved` (`droppedCount`: unmapped key, bad quality,
 * non-finite, out of range). Logs carry counts and the gateway's id and code,
 * never a sample value or key; the rejection line is throttled to one per
 * gateway a minute, with the counts summed since the last one.
 */
export function createUplinkReceiver(deps: UplinkReceiverDeps): ReceiveBatch {
  const writeTimeoutMs = deps.writeTimeoutMs ?? UPLINK_WRITE_TIMEOUT_MS;
  const pendingRejected = new Map<string, { lastLogMs: number | undefined; counts: Rejected }>();

  const noteRejected = (gateway: GatewayRecord, rejected: Rejected, nowMs: number): void => {
    const entry = pendingRejected.get(gateway.id) ?? {
      lastLogMs: undefined,
      counts: { foreignDevice: 0, futureRx: 0, tooOld: 0, unresolved: 0 },
    };
    entry.counts.foreignDevice += rejected.foreignDevice;
    entry.counts.futureRx += rejected.futureRx;
    entry.counts.tooOld += rejected.tooOld;
    entry.counts.unresolved += rejected.unresolved;
    pendingRejected.set(gateway.id, entry);
    if (entry.lastLogMs !== undefined && nowMs - entry.lastLogMs < REJECTED_LOG_INTERVAL_MS) {
      return;
    }
    deps.logger.warn("uplink samples rejected", { gatewayId: gateway.id, gatewayCode: gateway.code, ...entry.counts });
    entry.lastLogMs = nowMs;
    entry.counts = { foreignDevice: 0, futureRx: 0, tooOld: 0, unresolved: 0 };
  };

  return async (gateway, batch, digest) => {
    const now = deps.now();
    const served = deps.edgeServed().get(gateway.id);
    const screened = screenBatch(batch, served?.deviceKeys ?? NO_DEVICES, now);
    const resolved = resolveSamples(screened.samples, served?.pointIndex ?? NO_POINTS, undefined);
    const { rows, counters } = resolved;
    const unresolved = droppedCount(counters);

    const client = await deps.connect();
    const write = writeUplinkRows(client, rows, {
      now,
      liveWindowMs: deps.liveWindowMs,
      report: { gatewayId: gateway.id, buffered: batch.buffered, clock: batch.clock, tokenDigest: digest },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new UplinkWriteTimeout(writeTimeoutMs)), writeTimeoutMs);
    });
    let written: WriteResult;
    try {
      written = await Promise.race([write, timeout]);
    } catch (error) {
      // The abandoned write may still settle; it must not become an unhandled rejection.
      write.catch(() => undefined);
      client.release(error instanceof Error ? error : new Error("uplink write failed"));
      throw error;
    } finally {
      clearTimeout(timer);
    }
    client.release();
    // Committed: last-seen and drops for the gateway's RTUs. The endpoint key
    // is the gateway's id, never its code or a device key (ADR 0123 logs).
    deps.recordHealth({
      endpointKey: `edge:${gateway.id}`,
      rtuIdOf: (deviceKey) => served?.rtuIdByDeviceKey.get(deviceKey),
      result: resolved,
    });

    const rejected = { ...screened.rejected, unresolved };
    if (rejected.foreignDevice + rejected.futureRx + rejected.tooOld + rejected.unresolved > 0) {
      noteRejected(gateway, rejected, now.getTime());
    }
    if (written.rowsNotNotified > 0) {
      deps.logger.info("uplink rows written outside the live window, not notified", {
        gatewayId: gateway.id,
        rowsWritten: written.rowsWritten,
        rowsNotNotified: written.rowsNotNotified,
      });
    }
    return { accepted: written.rowsWritten, rejected };
  };
}
