import type { IngestProtocol, SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger, IngestAdapter, IngestAdapterFactory } from "../adapter/types.js";
import { backoffDelayMs, DEFAULT_BACKOFF, type BackoffPolicy } from "@bms/shared/ingest";
import type { EndpointPlan } from "./bindings.js";
import type { BufferedSegment, DiskBufferHandle } from "./disk-buffer.js";
import { createSampleQueue, DEFAULT_QUEUE_CAPACITY, type SampleQueue } from "./sample-queue.js";

/**
 * One supervisor per endpoint (ADR 0016 §5).
 *
 * "A failing adapter's blast radius is exactly one endpoint" is the acceptance
 * criterion for this whole module. A supervisor that fails restarts only its
 * own adapter instance; sibling endpoints — including the live PHE MQTT broker
 * connection — are untouched by another protocol's failure. This is the direct
 * replacement for today's `main().catch(… process.exit(1))`.
 *
 * **Every timer in the system lives here.** Adapters own none (§5 rule 4), which
 * is what lets one backoff implementation, one overlap guard and one bounded
 * queue serve all six protocols instead of being written six times.
 */

/** Injected so backoff, poll cadence and timeouts are testable without real time. */
export type Scheduler = {
  now(): Date;
  /** Resolves after `ms`, or **early and without rejecting** when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

export const realScheduler: Scheduler = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      function onAbort(): void {
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }),
};

/** The ADR 0016 §5 table. Overridable only so tests need not wait 30 seconds. */
export type SupervisorTimings = {
  readonly connectTimeoutMs: number;
  readonly disconnectTimeoutMs: number;
  /** How often a push adapter's `health()` is checked for transport loss. */
  readonly healthPollMs: number;
  /** How long the drain loop waits when the queue is empty. */
  readonly drainIdleMs: number;
  /** Samples per write batch. */
  readonly drainBatchSize: number;
  /** Consecutive `poll()` failures before the endpoint reports `degraded`. */
  readonly pollFailuresBeforeDegraded: number;
  /**
   * Ceiling on one `writeSamples` call.
   *
   * Not in the §5 table, and added because building the supervisor exposed the
   * gap: a `pg` query that never settles — a lock wait, a dead connection the
   * kernel has not yet reaped — would stall this endpoint's drain loop forever
   * while the bounded queue silently filled and dropped. The failure would show
   * up as "telemetry stopped" with a healthy-looking `connected` state.
   */
  readonly writeTimeoutMs: number;
  /**
   * Ceiling on `stop()`.
   *
   * Same reasoning as `disconnect()`'s 5 s abandon: shutdown must complete even
   * when something downstream refuses to.
   */
  readonly stopTimeoutMs: number;
  readonly backoff: BackoffPolicy;
  readonly queueCapacity: number;
};

export const DEFAULT_TIMINGS: SupervisorTimings = {
  connectTimeoutMs: 30_000,
  disconnectTimeoutMs: 5_000,
  healthPollMs: 1_000,
  drainIdleMs: 200,
  drainBatchSize: 500,
  pollFailuresBeforeDegraded: 3,
  writeTimeoutMs: 30_000,
  stopTimeoutMs: 10_000,
  backoff: DEFAULT_BACKOFF,
  queueCapacity: DEFAULT_QUEUE_CAPACITY,
};

/**
 * How often an idle replay pass asks the store to apply its bounds.
 *
 * Not in `SupervisorTimings`: it is not a §5 number and nothing operational
 * turns on tuning it. A minute keeps the rolling hour honest to within a
 * minute while costing one pass over the in-memory segment map.
 */
const BUFFER_SWEEP_INTERVAL_MS = 60_000;

/**
 * One RTU's own liveness, tracked separately from the connection's (`F1.7`).
 *
 * **An endpoint's `lastSampleAt` cannot answer "is this RTU alive".** MQTT's
 * `endpointKey` is `${host}:${port}`, so the whole PHE fleet shares one
 * connection and one supervisor; any sample from any RTU refreshed the
 * endpoint's timestamp. That was true and harmless while one RTU was enabled,
 * and false the moment a second was. Keyed on `deviceKey` because that is what
 * `SourceSample` carries — `rtuCode` is what an operator reads.
 */
export type DeviceHealth = {
  readonly rtuCode: string;
  readonly deviceKey: string;
  /** Absent means this RTU has produced nothing since the host started. */
  readonly lastSampleAt?: Date;
};

/** Operator-facing state for one endpoint — what `F3.16` consumes. */
export type SupervisorHealth = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  readonly state: "connected" | "degraded" | "disconnected";
  readonly detail?: string;
  /** The most recent sample from *any* device here — connection liveness, not RTU liveness. */
  readonly lastSampleAt?: Date;
  /** The RTUs that genuinely share this connection and would fail together (§5). */
  readonly devices: readonly DeviceHealth[];
  readonly restarts: number;
  readonly consecutivePollFailures: number;
  readonly queueDepth: number;
  readonly droppedSamples: number;
  readonly writeFailures: number;
  readonly samplesWritten: number;
  /** Samples on disk for this endpoint — a gauge, and `buffered>0` degrades the host. */
  readonly buffered: number;
  /**
   * Where the last batch went — a state, not a counter.
   *
   * `ok`: it was written, live or from the backlog. `buffering`: the breaker is
   * open and it went to disk. `losing`: it was neither written nor spilled, so
   * it is gone.
   *
   * It exists because `buffered` alone cannot see the worst case. A batch that
   * fails to write **and** fails to append leaves `buffered` at 0, every
   * endpoint `connected` and the host verdict `ok` while `bufferDropped`
   * climbs — the healthy-looking loss Amendment 4 decision 9 exists to remove.
   * The verdict cannot read `bufferDropped` instead: that is a lifetime
   * counter, and a host would then be degraded for ever over one batch it lost
   * an hour ago (AGENTS.md §4.6).
   */
  readonly writePath: "ok" | "buffering" | "losing";
  /** Samples erased by a bound, unparseable, or lost to a failed append — a counter. */
  readonly bufferDropped: number;
  /**
   * Samples written *from disk* since start — a counter.
   *
   * It can exceed the number of distinct samples that were buffered: a write
   * failure part-way through a segment abandons it uncommitted, so the head of
   * that segment is written again on the next pass (idempotently, decision 8).
   */
  readonly replayed: number;
};

export type Supervisor = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  /** Starts the supervise loop. Returns immediately; the loop runs until `stop()`. */
  start(): void;
  /** Aborts the adapter, drains what it can, and settles. Idempotent. */
  stop(): Promise<void>;
  health(): SupervisorHealth;
};

export type SupervisorDeps = {
  readonly factory: IngestAdapterFactory;
  readonly plan: EndpointPlan;
  readonly logger: AdapterLogger;
  readonly scheduler?: Scheduler;
  /** Jitter source. Injected so the spread is assertable. */
  readonly random?: () => number;
  readonly timings?: Partial<SupervisorTimings>;
  /**
   * The endpoint's disk tier (ADR 0016 Amendment 4 decision 2).
   *
   * Required, not optional: ruling 4 says a host that cannot buffer does not
   * start, so an optional "no buffer" branch would be a production-unreachable
   * path keeping the old loss route alive with nothing covering it.
   */
  readonly buffer: DiskBufferHandle;
  /**
   * Writes one batch. Throwing means the batch is appended to `buffer` and the
   * endpoint enters *buffering* — every later batch goes to disk without a
   * database attempt until a replay probe succeeds (Amendment 4 decision 3).
   * The batch is lost only when the disk append fails too, and that loss is
   * counted in `bufferDropped`.
   */
  writeSamples(samples: readonly SourceSample[]): Promise<void>;
};

/** Races `work` against a timeout without leaving an unhandled rejection behind. */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  scheduler: Scheduler,
  label: string,
): Promise<T> {
  const timer = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    void work.then(
      (value) => {
        if (settled) return;
        settled = true;
        timer.abort();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        timer.abort();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
    void scheduler.sleep(ms, timer.signal).then(() => {
      if (settled || timer.signal.aborted) return;
      settled = true;
      reject(new Error(`${label} exceeded ${ms} ms`));
    });
  });
}

/**
 * Builds the supervisor for one endpoint. Nothing runs until `start()`.
 *
 * `scheduler` and `random` are injected so the §5 timings and the backoff
 * spread are assertable without waiting out a 60-second cap.
 */
export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const timings: SupervisorTimings = { ...DEFAULT_TIMINGS, ...deps.timings };
  const scheduler = deps.scheduler ?? realScheduler;
  const random = deps.random ?? Math.random;
  const { plan, factory, logger } = deps;
  const queue: SampleQueue = createSampleQueue(timings.queueCapacity);

  const stopController = new AbortController();
  let stopped = false;
  let running: Promise<void> | null = null;
  let draining: Promise<void> | null = null;
  let replaying: Promise<void> | null = null;

  let state: SupervisorHealth["state"] = "disconnected";
  let detail: string | undefined;
  let lastSampleAt: Date | undefined;
  let restarts = 0;
  let consecutivePollFailures = 0;
  let writeFailures = 0;
  let samplesWritten = 0;
  let replayed = 0;
  /**
   * The breaker (decision 3): while set, the drain loop spills without touching
   * the database. Written by both loops — the drain loop sets it after a
   * successful spill, the replay loop clears it on a successful probe.
   */
  let buffering = false;
  /** Decision 9's gauge — see `SupervisorHealth.writePath`. */
  let writePath: SupervisorHealth["writePath"] = "ok";
  /**
   * Spills in flight, so the replay loop's safety valve below cannot clear the
   * breaker in the window between a write failing and its batch reaching disk.
   * Without it the valve's correctness rests on two loops' microtask ordering.
   */
  let spilling = 0;
  /**
   * Samples lost to an `append` that **rejected**, added to the store's own
   * `dropped` in `health()`.
   *
   * A second component rather than a second meaning: the store counts a batch
   * it refused, but it cannot count one it rejected on — its counter is
   * unreachable precisely when the call did not return. Without this
   * `bufferDropped` under-reports against its own documented meaning ("lost to
   * a failed append"), and `writePath=losing` would be the only trace of a
   * batch that is gone.
   */
  let bufferRejected = 0;
  /** When the idle replay pass last swept the store's bounds; `null` until the first. */
  let lastSweepAtMs: number | null = null;

  /** The adapter instance currently supervised, and the controller that aborts it. */
  let current: { adapter: IngestAdapter; controller: AbortController } | null = null;

  /** `deviceKey → rtuCode`, so a sample is attributed without rescanning bindings. */
  const rtuCodeByDeviceKey = new Map(
    plan.bindings.map((binding) => [binding.deviceKey, binding.rtuCode] as const),
  );
  /** `deviceKey → the last time this RTU produced anything` (`F1.7`). */
  const lastSampleByDeviceKey = new Map<string, Date>();
  /** The endpoint's only binding, if it has exactly one — see `accept()`. */
  const soleDeviceKey = plan.bindings.length === 1 ? plan.bindings[0]?.deviceKey : undefined;

  function accept(samples: readonly SourceSample[], controller: AbortController): void {
    // Defence in depth: an adapter must not emit after `disconnect()` (§5 rule
    // 8), and the conformance suite asserts it — but the host refusing late
    // samples too means one non-conforming adapter cannot write through a
    // supervisor that has already moved on.
    if (stopped || controller.signal.aborted) {
      return;
    }
    if (samples.length === 0) {
      return;
    }
    queue.push(samples);
    const now = scheduler.now();
    lastSampleAt = now;
    // Attributed per device, not per batch. An adapter may emit one device's
    // readings or several in a single call, and only the devices actually
    // present are refreshed — crediting the whole batch to every bound RTU
    // would reinstate the very blindness this replaces.
    for (const sample of samples) {
      // `deviceKey` is optional and "omit when it has exactly one" binding
      // (`SourceSample`), so the same `soleDeviceKey` rule the normaliser
      // applies has to apply here. Without it a single-device endpoint — every
      // Modbus gateway — would record no liveness at all and read stale for
      // ever while writing rows perfectly well.
      const deviceKey = sample.deviceKey ?? soleDeviceKey;
      // A sample for a `deviceKey` this supervisor has no binding for is
      // ignored rather than recorded: the map is keyed to the plan, so an
      // unknown key would create an RTU that health then reports on for ever.
      // An omitted key on a multi-device endpoint is ambiguous, and the
      // normaliser drops that sample too rather than guessing.
      if (deviceKey !== undefined && rtuCodeByDeviceKey.has(deviceKey)) {
        lastSampleByDeviceKey.set(deviceKey, now);
      }
    }
  }

  /**
   * Resolves the omitted `deviceKey` before a batch leaves for disk.
   *
   * A sole-binding endpoint may legitimately omit it (`SourceSample`), and
   * `accept()` resolves it for liveness — but the spill keeps the raw sample.
   * Enable a second RTU on that endpoint and restart during the outage and
   * `soleDeviceKey` is `undefined` for the new plan, so every replayed line
   * resolves `ambiguousDevice`. `writeResolved` then returns `rowsWritten: 0`
   * **without throwing**, the replay loop counts the batch as replayed and the
   * segment is unlinked: the backlog is gone with `bufferDropped` still 0.
   * Stamping at spill time means the disk carries what the plan meant when the
   * sample arrived.
   */
  function stampDeviceKeys(batch: readonly SourceSample[]): readonly SourceSample[] {
    if (soleDeviceKey === undefined) {
      return batch;
    }
    return batch.map((sample) =>
      sample.deviceKey === undefined ? { ...sample, deviceKey: soleDeviceKey } : sample,
    );
  }

  /**
   * One `catch` per external call (§5 rule 9).
   *
   * The store's contract is that `append` resolves `false` rather than
   * rejecting, but a contract is not a guarantee — an injected filesystem, a
   * future store, or a bug inside `enqueue` could reject, and an unhandled
   * rejection here would kill the drain loop silently and stop the endpoint
   * writing at all.
   *
   * The batch is counted here rather than in the store, because a store that
   * rejected is a store whose `dropped` never moved — see `bufferRejected`.
   */
  async function appendToBuffer(batch: readonly SourceSample[]): Promise<boolean> {
    try {
      return await deps.buffer.append(stampDeviceKeys(batch));
    } catch (error) {
      bufferRejected += batch.length;
      logger.error("disk buffer append rejected; batch lost", {
        endpointKey: plan.endpointKey,
        samples: batch.length,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return false;
    }
  }

  /** Same reasoning as `appendToBuffer`: a rejection must not end the replay loop. */
  async function readOldestSegment(): Promise<BufferedSegment | null> {
    try {
      return await deps.buffer.oldest();
    } catch (error) {
      logger.error("disk buffer read rejected; retrying after backoff", {
        endpointKey: plan.endpointKey,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return null;
    }
  }

  /** Same again, and a failed sweep must not stop the loop that keeps the bounds honest. */
  async function sweepBuffer(): Promise<void> {
    try {
      await deps.buffer.sweep();
    } catch (error) {
      logger.error("disk buffer sweep rejected", {
        endpointKey: plan.endpointKey,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async function safeDisconnect(adapter: IngestAdapter): Promise<void> {
    try {
      await withTimeout(
        adapter.disconnect(),
        timings.disconnectTimeoutMs,
        scheduler,
        "disconnect()",
      );
    } catch (error) {
      // "then the supervisor abandons the instance" (§5). A hung disconnect
      // must not stop the endpoint being restarted.
      logger.warn("adapter disconnect abandoned", {
        endpointKey: plan.endpointKey,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  /** Push mode: the adapter drives, so the supervisor watches for transport loss. */
  async function watchPushHealth(adapter: IngestAdapter, signal: AbortSignal): Promise<void> {
    for (;;) {
      await scheduler.sleep(timings.healthPollMs, signal);
      if (stopped || signal.aborted) {
        return;
      }
      const health = adapter.health();
      if (health.state === "disconnected") {
        throw new Error(health.detail ?? "transport disconnected");
      }
      state = health.state;
      detail = health.detail;
    }
  }

  /** Poll mode: the host drives, and never overlaps two reads. */
  async function runPollLoop(adapter: IngestAdapter, signal: AbortSignal): Promise<void> {
    if (adapter.mode !== "poll") {
      return;
    }
    for (;;) {
      if (stopped || signal.aborted) {
        return;
      }
      try {
        const samples = await adapter.poll();
        consecutivePollFailures = 0;
        state = "connected";
        detail = undefined;
        accept(samples, current?.controller ?? stopController);
      } catch (error) {
        consecutivePollFailures += 1;
        logger.warn("poll failed", {
          endpointKey: plan.endpointKey,
          consecutiveFailures: consecutivePollFailures,
          reason: error instanceof Error ? error.message : "unknown",
        });
        if (consecutivePollFailures >= timings.pollFailuresBeforeDegraded) {
          // §5 sets the threshold for `degraded`, not for a restart. A polled
          // device that is merely unreachable recovers on its own, and tearing
          // the connection down every third failure would turn a flapping
          // sensor into a reconnect storm. Backoff governs *connect* failures.
          state = "degraded";
          detail = `${consecutivePollFailures} consecutive poll failures`;
        }
      }
      // "next tick is scheduled only after `poll()` settles" — overlap is
      // forbidden (§5), which is why this awaits rather than using setInterval.
      await scheduler.sleep(adapter.defaultPollIntervalMs, signal);
    }
  }

  async function superviseLoop(): Promise<void> {
    let attempt = 0;
    while (!stopped) {
      const controller = new AbortController();
      const adapter = factory.create();
      current = { adapter, controller };

      try {
        await withTimeout(
          adapter.connect({
            protocol: plan.protocol,
            endpointKey: plan.endpointKey,
            config: plan.config,
            credentials: plan.credentials,
            bindings: plan.bindings,
            logger,
            signal: controller.signal,
          }),
          timings.connectTimeoutMs,
          scheduler,
          "connect()",
        );

        state = "connected";
        detail = undefined;
        // A successful connect resets the backoff: an endpoint that reconnects
        // cleanly after an hour should retry in one second next time, not sixty.
        attempt = 0;
        logger.info("endpoint connected", {
          endpointKey: plan.endpointKey,
          protocol: plan.protocol,
          devices: plan.bindings.length,
        });

        if (adapter.mode === "push") {
          await adapter.subscribe((samples) => {
            accept(samples, controller);
          });
          await watchPushHealth(adapter, controller.signal);
        } else {
          await runPollLoop(adapter, controller.signal);
        }
      } catch (error) {
        state = "disconnected";
        detail = error instanceof Error ? error.message : "unknown failure";
        // Rule 9: never a silent `catch {}`. This is the line whose absence
        // ADR 0016's Context calls out as load-bearing.
        logger.error("endpoint failed", {
          endpointKey: plan.endpointKey,
          protocol: plan.protocol,
          reason: detail,
        });
      } finally {
        controller.abort();
        await safeDisconnect(adapter);
        current = null;
      }

      if (stopped) {
        return;
      }

      const delay = backoffDelayMs(attempt, random, timings.backoff);
      attempt += 1;
      restarts += 1;
      logger.warn("endpoint restarting", {
        endpointKey: plan.endpointKey,
        delayMs: delay,
        attempt,
      });
      await scheduler.sleep(delay, stopController.signal);
    }
  }

  async function drainLoop(): Promise<void> {
    while (!stopped || queue.depth > 0) {
      const batch = queue.drain(timings.drainBatchSize);
      if (batch.length === 0) {
        if (stopped) {
          return;
        }
        await scheduler.sleep(timings.drainIdleMs, stopController.signal);
        continue;
      }
      if (buffering) {
        // Decision 3: no database attempt while the breaker is open, and no
        // per-batch log. Attempting each batch would cost `writeTimeoutMs` per
        // batch and starve the memory queue into drop-oldest — loss by another
        // route, with `dropped=` rising while `writeFailures=` explained it.
        // A failed append is counted in `bufferDropped` inside the store — or
        // by `appendToBuffer` when the store rejected — and never thrown here
        // (decision 10), but it is still a lost batch, so it has to reach the
        // health line as one.
        //
        // `spilling` is raised here for the same reason the `catch` path below
        // raises it, and its absence here was a hole: once the breaker is open
        // *this* is the branch that appends, and a bound that erased the whole
        // backlog leaves `buffered` at 0 while the append is still in flight.
        // The valve then shuts the breaker under the drain loop, and the next
        // batch spends `writeTimeoutMs` on a database that is still down.
        spilling += 1;
        try {
          writePath = (await appendToBuffer(batch)) ? "buffering" : "losing";
        } finally {
          spilling -= 1;
        }
        continue;
      }
      try {
        await withTimeout(
          deps.writeSamples(batch),
          timings.writeTimeoutMs,
          scheduler,
          "writeSamples()",
        );
        samplesWritten += batch.length;
        writePath = "ok";
      } catch (error) {
        writeFailures += 1;
        logger.error("sample batch write failed; spilling to disk", {
          endpointKey: plan.endpointKey,
          samples: batch.length,
          reason: error instanceof Error ? error.message : "unknown",
        });
        // The breaker opens only once the batch is actually on disk. If the
        // append failed there is nothing to replay, so no probe would ever
        // fire and the endpoint would sit buffering with an empty buffer.
        spilling += 1;
        try {
          if (await appendToBuffer(batch)) {
            buffering = true;
            writePath = "buffering";
          } else {
            // Neither written nor kept. `buffered` stays 0 and every endpoint
            // stays `connected`, so without this the host reports `ok` while
            // telemetry is being destroyed.
            writePath = "losing";
          }
        } finally {
          spilling -= 1;
        }
      }
    }
  }

  /**
   * The disk tier's replay, one loop for the life of the supervisor (decisions
   * 4, 5 and 8).
   *
   * There is no separate probe query: the next real write *is* the probe, on
   * the same §5 backoff the connect path uses. Progress is per segment — a
   * segment is unlinked only after every one of its lines is written, so a
   * failure part-way re-replays at most one minute, idempotently. Between
   * batches it yields `drainIdleMs` so live telemetry is never queued behind an
   * hour of backlog.
   */
  async function replayLoop(): Promise<void> {
    let attempt = 0;
    /**
     * Consecutive `null`s from `oldest()`, counted apart from the probe's
     * `attempt`. Sharing one counter would reset the probe backoff on every
     * pass that read a segment, which is every pass of a real outage — the §5
     * doubling would never leave 1 s.
     */
    let unreadableAttempts = 0;
    while (!stopped) {
      // Above the branch, not inside it. The age bound is a rolling hour, not
      // a rolling hour of appends, and the outage it exists for is the broker
      // down *and* the database down: then `buffered > 0`, nothing appends, and
      // a sweep that only ran on the drained branch would never run at all —
      // the segments would age past `maxAgeMs` and be replayed rather than
      // erased. One pass over an in-memory map, once a minute, either way.
      const sweepAtMs = scheduler.now().getTime();
      if (lastSweepAtMs === null || sweepAtMs - lastSweepAtMs >= BUFFER_SWEEP_INTERVAL_MS) {
        lastSweepAtMs = sweepAtMs;
        await sweepBuffer();
      }
      if (spilling === 0 && deps.buffer.buffered === 0) {
        // The safety valve. Both bounds erase segments the supervisor never
        // sees, so "the buffer is empty" has to be able to close the breaker
        // on its own — otherwise an endpoint whose backlog aged out would
        // spill for ever without attempting the database again.
        buffering = false;
        // A recovery, so the probe backoff starts again — the same reason
        // `superviseLoop` resets on a successful connect. Without this, an
        // endpoint whose backlog aged out at the 60 s ceiling meets the next
        // outage with the last one's delay, and its first probe waits a minute
        // instead of a second.
        attempt = 0;
        if (writePath === "buffering") {
          // The breaker is shut; "while the breaker is open" is no longer
          // true, and leaving it would degrade the host for ever on an
          // endpoint that drained and then went quiet. `losing` is left alone
          // — only a write or an append can clear that.
          writePath = "ok";
        }
        await scheduler.sleep(timings.drainIdleMs, stopController.signal);
        continue;
      }
      const segment = await readOldestSegment();
      if (segment === null) {
        if (deps.buffer.buffered === 0) {
          // The ordinary window between a write failing and its batch reaching
          // disk: `spilling` held the branch above open, and there is nothing
          // to replay yet. Nothing is unreadable, so this must neither warn nor
          // touch the backoff — counting it would escalate the §5 delay on
          // every spill, and the first genuinely unreadable pass after a busy
          // hour would then wait the ceiling instead of a second.
          await scheduler.sleep(timings.drainIdleMs, stopController.signal);
          continue;
        }
        // `oldest()` resolves `null` with a segment still on disk when a read
        // failed and kept it for the next pass. `drainIdleMs` here was five
        // error lines a second for as long as the segment stayed unreadable, so
        // this rides the same §5 backoff the probe does. The store retires a
        // segment it has failed to read three times, so this is bounded from
        // both ends — except for a segment the volume refuses to unlink, which
        // is skipped, logged once by the store, and waits for an operator.
        const delay = backoffDelayMs(unreadableAttempts, random, timings.backoff);
        unreadableAttempts += 1;
        logger.warn("oldest segment unreadable; retrying after backoff", {
          endpointKey: plan.endpointKey,
          delayMs: delay,
          attempt: unreadableAttempts,
          buffered: deps.buffer.buffered,
        });
        await scheduler.sleep(delay, stopController.signal);
        continue;
      }
      unreadableAttempts = 0;
      let abandoned = false;
      for (let start = 0; start < segment.samples.length; start += timings.drainBatchSize) {
        if (stopped) {
          abandoned = true;
          break;
        }
        const batch = segment.samples.slice(start, start + timings.drainBatchSize);
        try {
          await withTimeout(
            deps.writeSamples(batch),
            timings.writeTimeoutMs,
            scheduler,
            "writeSamples()",
          );
        } catch (error) {
          // A probe is a rejected `writeSamples` like any other, so it counts:
          // `writeFailures` is the signal that an outage is costing telemetry,
          // and a counter frozen at 1 for an hour would not carry it.
          writeFailures += 1;
          buffering = true;
          // The backlog is still on disk, so this is not loss.
          writePath = "buffering";
          const delay = backoffDelayMs(attempt, random, timings.backoff);
          attempt += 1;
          logger.warn("replay write failed; probing after backoff", {
            endpointKey: plan.endpointKey,
            delayMs: delay,
            attempt,
            buffered: deps.buffer.buffered,
            reason: error instanceof Error ? error.message : "unknown",
          });
          await scheduler.sleep(delay, stopController.signal);
          abandoned = true;
          break;
        }
        replayed += batch.length;
        writePath = "ok";
        if (buffering) {
          logger.info("database write path recovered; replaying backlog", {
            endpointKey: plan.endpointKey,
            buffered: deps.buffer.buffered,
          });
          buffering = false;
        }
        attempt = 0;
        // Live before backlog (decision 5): the drain loop takes this yield to
        // write what is arriving now.
        await scheduler.sleep(timings.drainIdleMs, stopController.signal);
      }
      if (!abandoned && !stopped) {
        await segment.commit();
      }
    }
  }

  return {
    protocol: plan.protocol,
    endpointKey: plan.endpointKey,

    start() {
      if (running !== null) {
        return;
      }
      running = superviseLoop();
      // The order of these two is **not** load-bearing, and the comment that
      // said it was claimed a guarantee nothing holds: swapping them leaves
      // every assertion green. What actually keeps live telemetry in front of
      // an hour of backlog (decision 5) is the `drainIdleMs` yield the replay
      // loop takes between batches, which is gated by block C of
      // `supervisor-buffer.spec.ts`. Start order only decides which loop
      // registers its first sleep first, and both are asleep within a tick.
      draining = drainLoop();
      // Started with the rest, not on the first spill: a host restarted during
      // an outage has a backlog on disk and no broker connection yet, and
      // decision 8 says that restart loses nothing.
      replaying = replayLoop();
    },

    async stop() {
      stopped = true;
      stopController.abort();
      current?.controller.abort();
      const adapter = current?.adapter;
      if (adapter !== undefined) {
        await safeDisconnect(adapter);
      }
      // Bounded, for the same reason `disconnect()` is: a drain loop blocked on
      // a write that never settles must not hold shutdown open forever. The
      // loops observe `stopped` and unwind on their own once unblocked.
      const settle = Promise.allSettled([running, draining, replaying]);
      const abandon = new AbortController();
      await Promise.race([
        settle.then(() => {
          abandon.abort();
        }),
        scheduler.sleep(timings.stopTimeoutMs, abandon.signal).then(() => {
          if (!abandon.signal.aborted) {
            logger.warn("supervisor shutdown abandoned", {
              endpointKey: plan.endpointKey,
              queueDepth: queue.depth,
            });
          }
        }),
      ]);
      running = null;
      draining = null;
      replaying = null;
      state = "disconnected";
    },

    health() {
      return {
        protocol: plan.protocol,
        endpointKey: plan.endpointKey,
        state,
        ...(detail === undefined ? {} : { detail }),
        ...(lastSampleAt === undefined ? {} : { lastSampleAt }),
        // Built from the plan rather than from the sample map, so an RTU that
        // has never published still appears. A device that is simply absent
        // from health is indistinguishable from one that is fine.
        devices: plan.bindings.map((binding) => {
          const seen = lastSampleByDeviceKey.get(binding.deviceKey);
          return {
            rtuCode: binding.rtuCode,
            deviceKey: binding.deviceKey,
            ...(seen === undefined ? {} : { lastSampleAt: seen }),
          };
        }),
        restarts,
        consecutivePollFailures,
        queueDepth: queue.depth,
        droppedSamples: queue.dropped,
        writeFailures,
        samplesWritten,
        buffered: deps.buffer.buffered,
        writePath,
        // The store's losses plus the ones only the supervisor saw: a batch
        // whose `append` rejected never reached the store's counter.
        bufferDropped: deps.buffer.dropped + bufferRejected,
        replayed,
      };
    },
  };
}
