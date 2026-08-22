import type { IngestProtocol, SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger, IngestAdapter, IngestAdapterFactory } from "../adapter/types.js";
import { backoffDelayMs, DEFAULT_BACKOFF, type BackoffPolicy } from "@bms/shared/ingest";
import type { EndpointPlan } from "./bindings.js";
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
   * Writes one batch. Throwing means the batch is lost and counted — durable
   * buffering across a database outage is `F1.10`, explicitly out of scope here
   * (§5, "Disk buffering — out of scope").
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

  let state: SupervisorHealth["state"] = "disconnected";
  let detail: string | undefined;
  let lastSampleAt: Date | undefined;
  let restarts = 0;
  let consecutivePollFailures = 0;
  let writeFailures = 0;
  let samplesWritten = 0;

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
      try {
        await withTimeout(
          deps.writeSamples(batch),
          timings.writeTimeoutMs,
          scheduler,
          "writeSamples()",
        );
        samplesWritten += batch.length;
      } catch (error) {
        // The batch is lost. `F1.10` owns making that survivable with a disk
        // buffer; until then the honest thing is to count it and say so rather
        // than retry forever behind a queue that is already bounded.
        writeFailures += 1;
        logger.error("sample batch write failed", {
          endpointKey: plan.endpointKey,
          samples: batch.length,
          reason: error instanceof Error ? error.message : "unknown",
        });
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
      draining = drainLoop();
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
      const settle = Promise.allSettled([running, draining]);
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
      };
    },
  };
}
