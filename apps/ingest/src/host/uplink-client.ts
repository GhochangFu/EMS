import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

import {
  type IngestProtocol,
  UPLINK_MAX_BODY_BYTES,
  UPLINK_MAX_DECODED_BYTES,
  type UplinkBatch,
  UPLINK_REFUSAL_STATUS,
  type UplinkRefusal,
  uplinkResponseSchema,
  type UplinkSample,
  uplinkSampleSchema,
} from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";
import type { ReceivedSample } from "./received-sample.js";
import type { Scheduler } from "./supervisor.js";

const gzip = promisify(gzipCallback);

/**
 * The edge's uplink client (`E7.2`, ADR 0123 decisions 4, 8 and 9, plan T5.4
 * with C3, C4 and M5) — the edge supervisor's `writeSamples`.
 *
 * The supervisor is unchanged (plan M3): it hands this a batch, and **a
 * resolve means done, a reject means spill**. Everything the `F1.10` state
 * machine does — the disk spill, the breaker, the §5 backoff probe, live
 * before backlog — therefore works across the internet exactly as it works
 * against a database.
 *
 * **Outcomes (C4).** `200` is done. `400`, `413` and `422` are refusals no
 * retry can fix: the batch is counted `uplinkRefused`, logged, and resolved,
 * so one poison batch cannot hold every later one behind the breaker (M4).
 * Everything else — a network error, the 20 s abort, `401`, `403` (a token
 * being rotated must not delete data), `429`, any `5xx` — rejects, and the
 * supervisor keeps the batch on disk. A `Retry-After` sets a not-before time
 * (capped at 5 min) before which nothing is posted at all.
 *
 * **Backlog (C3).** A batch is `backlog` when its oldest sample is more than
 * 10 s old on the edge clock. Backlog batches only wait on a virtual schedule
 * at `EDGE_REPLAY_MAX_SAMPLES_PER_S`; live batches never do.
 *
 * **One post at a time.** The receiver answers `429 busy` to a second batch
 * in flight for one gateway, and the drain and replay loops of every endpoint
 * share one token, so posts are serialised here, a waiting live batch ahead
 * of a waiting backlog one.
 *
 * **The token** is sent once, as `authorization: Bearer <token>`, and appears
 * in no log line and no thrown message (AGENTS.md §9.6). Thrown messages are
 * fixed text plus a status or an errno code — never a `fetch` error's own
 * message, which may quote the URL.
 */

/** The receiver's one route (`UPLINK_PATH` in `uplink-server.ts`, which the edge must not import). */
export const EDGE_UPLINK_PATH = "/edge/v1/batches";
/** Each post is aborted after this long (plan C4); the receiver gives up at 15 s, first. */
export const UPLINK_POST_TIMEOUT_MS = 20_000;
/** A batch whose oldest sample is older than this is backlog (plan C3). */
export const BACKLOG_AGE_MS = 10_000;
/** The longest `Retry-After` honoured (plan C4). */
export const RETRY_AFTER_CAP_MS = 300_000;
/** How long a batch waits for the post in flight before it is a retry-later. */
export const LOCK_WAIT_MS = 20_000;
/**
 * The edge supervisor's `writeTimeoutMs`. The supervisor's default 30 s does
 * not cover one call here: a backlog batch may wait 10 s on the throttle at
 * the 50/s floor, up to `LOCK_WAIT_MS` for the post ahead of it, then
 * `UPLINK_POST_TIMEOUT_MS` per body — two when a batch is split. A timeout
 * only abandons the wait (the batch is spilled and any post that lands later
 * is an idempotent duplicate), so the bound is set above the sum.
 */
export const EDGE_WRITE_TIMEOUT_MS = 90_000;

/**
 * Final only when the **receiver** says so: a `400` or `413` whose body is
 * `{ error }` with one of its own codes for that status. A proxy's page, a
 * `422`, any other body is retried (ADR 0123 Amendment 2).
 */
function isTerminal(status: number, code: string | undefined): boolean {
  if (status !== 400 && status !== 413) return false;
  return (
    code !== undefined &&
    Object.prototype.hasOwnProperty.call(UPLINK_REFUSAL_STATUS, code) &&
    UPLINK_REFUSAL_STATUS[code as UplinkRefusal] === status
  );
}

/** How long a refused batch keeps the health verdict degraded — a recent window, not a lifetime counter. */
export const REFUSED_RECENT_MS = 600_000;

/** The request `fetch` is given. A narrow shape so a spec can capture it. */
export type UplinkFetchInit = {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly redirect: "error";
  readonly signal: AbortSignal;
};

/** The response slice used. Global `fetch` satisfies it. */
export type UplinkFetchResponse = {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type UplinkFetch = (url: string, init: UplinkFetchInit) => Promise<UplinkFetchResponse>;

/** A batch the cloud did not take, which stays on disk and is retried. The message never holds the token. */
export class UplinkRetryLater extends Error {
  constructor(reason: string) {
    super(`uplink: ${reason}; the batch stays on disk`);
    this.name = "UplinkRetryLater";
  }
}

export type UplinkClientDeps = {
  /** `EDGE_UPLINK_URL`, an `https:` origin (`edge-config.ts`). */
  readonly url: URL;
  /** `EDGE_GATEWAY_TOKEN`. Never logged, never echoed. */
  readonly token: string;
  readonly fetch: UplinkFetch;
  /** The edge clock: `backlog`, `sentAt`, the throttle and `Retry-After` all read it. */
  readonly scheduler: Scheduler;
  readonly logger: AdapterLogger;
  readonly maxBacklogSamplesPerS: number;
  /** Samples on disk across the store, sent as `buffered`. */
  readonly buffered: () => number;
  readonly clock: () => UplinkBatch["clock"];
  /**
   * A trusted cloud time: the `Date` header of a `200` whose body passed
   * `uplinkResponseSchema`, in ms since the epoch. The clock guard decides what
   * to make of it (`edge-clock.ts`, ADR 0123 Amendment 2). Absent or
   * unparseable headers are never passed on.
   */
  readonly onServerTime?: (serverMs: number) => void;
};

/** Counters and gauges for the edge health line. Rendered, never compared (AGENTS.md §4.6). */
export type UplinkStats = {
  readonly batchesSent: number;
  readonly accepted: number;
  readonly foreignDevice: number;
  readonly futureRx: number;
  readonly tooOld: number;
  readonly unresolved: number;
  /** Samples in batches the cloud refused for good (400/413/422). */
  readonly uplinkRefused: number;
  /** Samples with no `deviceKey` on a multi-device endpoint: never sent. */
  readonly unattributed: number;
  /** Samples the wire schema refused even without their device time (a non-finite value): never sent. */
  readonly invalid: number;
  /** Samples sent without `at` because their device time did not fit the wire; the cloud uses `rx`. */
  readonly deviceTimeDropped: number;
  /** When a batch was last refused for good; the health verdict degrades for `REFUSED_RECENT_MS` after it. */
  readonly lastRefusedAt?: Date;
  /** The last outcome: an HTTP status, `network` or `timeout`; absent before the first post. */
  readonly lastOutcome?: string;
  /** Before this, nothing is posted (`Retry-After`). */
  readonly notBefore?: Date;
};

export type UplinkPlan = {
  readonly protocol: IngestProtocol;
  readonly bindings: readonly { readonly deviceKey: string }[];
};

export type UplinkClient = {
  /** The `writeSamples` for one endpoint's supervisor. */
  writerFor(plan: UplinkPlan): (samples: readonly ReceivedSample[]) => Promise<void>;
  stats(): UplinkStats;
};

/** `Retry-After` as seconds or an HTTP date, in ms from `nowMs`, capped; `undefined` when absent or unreadable. */
function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === "") {
    return undefined;
  }
  const trimmed = header.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - nowMs;
  return Number.isFinite(ms) ? Math.min(RETRY_AFTER_CAP_MS, Math.max(0, ms)) : undefined;
}

/** A network failure's errno code, never its message. */
function networkCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "error";
}

function toWire(protocol: IngestProtocol, received: ReceivedSample, deviceKey: string): UplinkSample {
  const { sample } = received;
  const at = sample.at !== undefined && Number.isFinite(sample.at.getTime()) ? sample.at.toISOString() : undefined;
  return {
    protocol,
    sourceKey: sample.sourceKey,
    value: sample.value,
    deviceKey,
    ...(at === undefined ? {} : { at }),
    rx: received.receivedAt.toISOString(),
    ...(sample.good === undefined ? {} : { good: sample.good }),
  };
}

/** A one-slot lock whose live waiters go before its backlog waiters, with a bounded wait. */
function createPostLock(scheduler: Scheduler) {
  let held = false;
  const waiting: { live: boolean; grant: () => void }[] = [];
  const release = (): void => {
    const next = waiting.findIndex((w) => w.live);
    const [waiter] = waiting.splice(next === -1 ? 0 : next, 1);
    if (waiter === undefined) {
      held = false;
    } else {
      waiter.grant();
    }
  };
  return async (live: boolean): Promise<() => void> => {
    if (!held) {
      held = true;
      return release;
    }
    const timer = new AbortController();
    let granted = false;
    const entry = {
      live,
      grant: () => {
        granted = true;
        timer.abort();
      },
    };
    waiting.push(entry);
    await scheduler.sleep(LOCK_WAIT_MS, timer.signal);
    if (!granted) {
      waiting.splice(waiting.indexOf(entry), 1);
      throw new UplinkRetryLater("another post is still in flight");
    }
    return release;
  };
}

export function createUplinkClient(deps: UplinkClientDeps): UplinkClient {
  const { scheduler, logger } = deps;
  const endpoint = new URL(EDGE_UPLINK_PATH, deps.url).href;
  const acquire = createPostLock(scheduler);
  const msPerSample = 1000 / deps.maxBacklogSamplesPerS;
  let nextBacklogAtMs = Number.NEGATIVE_INFINITY;
  let notBeforeMs: number | undefined;
  /** The last retry-later reason logged, so a long outage writes one line per change, not per batch. */
  let lastProblem: string | undefined;
  const totals = {
    batchesSent: 0,
    accepted: 0,
    foreignDevice: 0,
    futureRx: 0,
    tooOld: 0,
    unresolved: 0,
    uplinkRefused: 0,
    unattributed: 0,
    invalid: 0,
    deviceTimeDropped: 0,
  };
  let lastOutcome: string | undefined;
  let lastRefusedAt: Date | undefined;

  /** At most one "not sent" line a minute, with the counts since the last one (nit: a busy endpoint must not flood the log). */
  let unsentLoggedAtMs: number | undefined;
  const unsentPending = { unattributed: 0, invalid: 0 };
  const noteUnsent = (protocol: IngestProtocol, unattributed: number, invalid: number): void => {
    unsentPending.unattributed += unattributed;
    unsentPending.invalid += invalid;
    const nowMs = scheduler.now().getTime();
    if (unsentLoggedAtMs !== undefined && nowMs - unsentLoggedAtMs < 60_000) return;
    unsentLoggedAtMs = nowMs;
    logger.warn("samples not sent: no device key, or not valid on the wire", { protocol, ...unsentPending });
    unsentPending.unattributed = 0;
    unsentPending.invalid = 0;
  };

  const deferred = (): boolean => notBeforeMs !== undefined && scheduler.now().getTime() < notBeforeMs;

  const retryLater = (outcome: string, reason: string): never => {
    lastOutcome = outcome;
    if (reason !== lastProblem) {
      lastProblem = reason;
      logger.warn("uplink post not accepted; batches stay on disk and are retried", { outcome });
    }
    throw new UplinkRetryLater(reason);
  };

  /** Bodies within both caps, splitting in halves until each fits. */
  async function encode(samples: readonly UplinkSample[], backlog: boolean): Promise<{ count: number; body: Buffer }[]> {
    const batch: UplinkBatch = {
      v: 1,
      sentAt: scheduler.now().toISOString(),
      backlog,
      buffered: deps.buffered(),
      clock: deps.clock(),
      samples: [...samples],
    };
    const json = Buffer.from(JSON.stringify(batch), "utf8");
    const body = json.length > UPLINK_MAX_DECODED_BYTES ? undefined : await gzip(json);
    if (body !== undefined && body.length <= UPLINK_MAX_BODY_BYTES) {
      return [{ count: samples.length, body }];
    }
    if (samples.length === 1) {
      // One sample over 256 KiB compressed: the receiver would answer 413 for ever.
      totals.uplinkRefused += 1;
      lastRefusedAt = scheduler.now();
      logger.error("uplink sample too large to send; dropped", { bytes: json.length });
      return [];
    }
    const half = Math.ceil(samples.length / 2);
    return [...(await encode(samples.slice(0, half), backlog)), ...(await encode(samples.slice(half), backlog))];
  }

  async function post(count: number, body: Buffer): Promise<void> {
    if (deferred()) {
      retryLater("deferred", "deferred by the receiver's Retry-After");
    }
    const abort = new AbortController();
    const timer = new AbortController();
    void scheduler.sleep(UPLINK_POST_TIMEOUT_MS, timer.signal).then(() => {
      if (!timer.signal.aborted) {
        abort.abort();
      }
    });
    let status: number;
    let retryAfter: string | null;
    let dateHeader: string | null;
    let text: string;
    try {
      const response = await deps.fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          authorization: `Bearer ${deps.token}`,
        },
        body,
        redirect: "error",
        signal: abort.signal,
      });
      status = response.status;
      retryAfter = response.headers.get("retry-after");
      dateHeader = response.headers.get("date");
      text = await response.text();
    } catch (error) {
      return abort.signal.aborted
        ? retryLater("timeout", `no answer within ${UPLINK_POST_TIMEOUT_MS} ms`)
        : retryLater("network", `unreachable (${networkCode(error)})`);
    } finally {
      timer.abort();
    }

    if (status === 200) {
      let parsed: ReturnType<typeof uplinkResponseSchema.safeParse>;
      try {
        parsed = uplinkResponseSchema.safeParse(JSON.parse(text));
      } catch {
        parsed = uplinkResponseSchema.safeParse(undefined);
      }
      if (!parsed.success) {
        // Not the receiver's answer (a proxy page with a 200): nothing says the rows are stored.
        return retryLater("200-unreadable", "answered 200 with a body that is not the receiver's");
      }
      // Only a schema-valid body is the receiver's own answer, so only its Date is trusted.
      const serverMs = dateHeader === null ? Number.NaN : Date.parse(dateHeader);
      if (Number.isFinite(serverMs)) {
        deps.onServerTime?.(serverMs);
      }
      const { rejected } = parsed.data;
      totals.accepted += parsed.data.accepted;
      totals.foreignDevice += rejected.foreignDevice;
      totals.futureRx += rejected.futureRx;
      totals.tooOld += rejected.tooOld;
      totals.unresolved += rejected.unresolved;
      if (count > 0 && rejected.futureRx === count) {
        // Every sample is ahead of the cloud's clock: our clock is wrong, not the
        // data. Keep it on disk under its bounds rather than delete a site's telemetry.
        return retryLater("future-rx", "every sample refused as ahead of the cloud's clock");
      }
      totals.batchesSent += 1;
      lastOutcome = "200";
      if (lastProblem !== undefined) {
        lastProblem = undefined;
        logger.info("uplink recovered", {});
      }
      return;
    }
    let code: string | undefined;
    try {
      const reason = (JSON.parse(text) as { error?: unknown } | null)?.error;
      code = typeof reason === "string" && /^[a-z-]{1,40}$/.test(reason) ? reason : undefined;
    } catch {
      code = undefined;
    }
    if (isTerminal(status, code)) {
      totals.uplinkRefused += count;
      lastOutcome = String(status);
      lastRefusedAt = scheduler.now();
      logger.error("uplink refused a batch; it cannot be retried and is dropped", { status, samples: count, error: code });
      return;
    }
    const wait = retryAfterMs(retryAfter, scheduler.now().getTime());
    if (wait !== undefined && (status === 429 || status === 503)) {
      notBeforeMs = scheduler.now().getTime() + wait;
    }
    return retryLater(String(status), `answered ${status}`);
  }

  return {
    writerFor(plan) {
      const soleDeviceKey = plan.bindings.length === 1 ? plan.bindings[0]?.deviceKey : undefined;
      return async (received) => {
        const wire: UplinkSample[] = [];
        let unattributed = 0;
        let invalid = 0;
        let oldestMs = Number.POSITIVE_INFINITY;
        for (const one of received) {
          // M5: the drain loop stamps a device key only on spill; the wire requires one.
          const deviceKey = one.sample.deviceKey ?? soleDeviceKey;
          if (deviceKey === undefined) {
            unattributed += 1;
            continue;
          }
          // One bad sample must never make the whole batch schema-invalid (a 400
          // would drop its neighbours): a device time that does not fit is left
          // off, and a sample that still does not fit is dropped alone.
          let sample = toWire(plan.protocol, one, deviceKey);
          if (!Number.isFinite(sample.value) || !uplinkSampleSchema.safeParse(sample).success) {
            const { at: _dropped, ...withoutAt } = sample;
            if (sample.at !== undefined && Number.isFinite(sample.value) && uplinkSampleSchema.safeParse(withoutAt).success) {
              totals.deviceTimeDropped += 1;
              sample = withoutAt;
            } else {
              invalid += 1;
              continue;
            }
          }
          oldestMs = Math.min(oldestMs, one.receivedAt.getTime());
          wire.push(sample);
        }
        totals.unattributed += unattributed;
        totals.invalid += invalid;
        if (unattributed + invalid > 0) {
          noteUnsent(plan.protocol, unattributed, invalid);
        }
        if (wire.length === 0) {
          return;
        }
        if (deferred()) {
          retryLater("deferred", "deferred by the receiver's Retry-After");
        }
        const nowMs = scheduler.now().getTime();
        const backlog = nowMs - oldestMs > BACKLOG_AGE_MS;
        if (backlog) {
          // A virtual schedule, not a refilling bucket: a backlog batch starts
          // no sooner than the previous one's share of the cap has elapsed.
          const startMs = Math.max(nowMs, nextBacklogAtMs);
          nextBacklogAtMs = startMs + wire.length * msPerSample;
          if (startMs > nowMs) {
            await scheduler.sleep(startMs - nowMs, new AbortController().signal);
          }
        }
        const release = await acquire(!backlog);
        try {
          for (const { count, body } of await encode(wire, backlog)) {
            await post(count, body);
          }
        } finally {
          release();
        }
      };
    },

    stats() {
      return {
        ...totals,
        ...(lastOutcome === undefined ? {} : { lastOutcome }),
        ...(lastRefusedAt === undefined ? {} : { lastRefusedAt }),
        ...(notBeforeMs === undefined || !deferred() ? {} : { notBefore: new Date(notBeforeMs) }),
      };
    },
  };
}
