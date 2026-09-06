import { z } from "zod";

import type { AdapterHealth, SourceSample } from "@bms/shared/ingest";

import type {
  AdapterContext,
  IngestAdapter,
  IngestAdapterFactory,
} from "../adapter/types.js";
import type { EndpointPlan } from "./bindings.js";
import type { DiskBufferHandle } from "./disk-buffer.js";
import { createSupervisor, type Scheduler } from "./supervisor.js";

/**
 * The harness below is exported for `supervisor-buffer.spec.ts`, which runs the
 * `F1.10` disk-tier blocks against the real store over a temp directory. Both
 * files are excluded from `tsconfig.build.json` and from coverage, so the
 * import costs nothing in `dist`; splitting them keeps each under §4.5's
 * 1000-line whole-file cap.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lets pending microtasks and the fake scheduler's resolutions settle. */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * A scheduler whose sleeps resolve only when the test says so.
 *
 * Real time would make the ADR 0016 §5 numbers untestable — a 30 s connect
 * timeout and a 60 s backoff cap cannot be waited on — and a fake that resolves
 * immediately turns the supervise loop into a spin that floods the assertions.
 * Gating each sleep makes the sequence of *requested* delays the observable,
 * which is exactly what the §5 table specifies.
 */
export function makeFakeScheduler(): {
  scheduler: Scheduler;
  delays: number[];
  flush(rounds?: number): Promise<void>;
  pending(): number;
} {
  type Entry = { resolve: () => void };
  const waiting: Entry[] = [];
  const delays: number[] = [];

  const scheduler: Scheduler = {
    now: () => new Date("2026-08-05T12:00:00.000Z"),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        delays.push(ms);
        if (signal.aborted) {
          resolve();
          return;
        }
        const entry: Entry = { resolve };
        waiting.push(entry);
        signal.addEventListener(
          "abort",
          () => {
            const index = waiting.indexOf(entry);
            if (index >= 0) {
              waiting.splice(index, 1);
              resolve();
            }
          },
          { once: true },
        );
      }),
  };

  return {
    scheduler,
    delays,
    pending: () => waiting.length,
    async flush(rounds = 1) {
      for (let i = 0; i < rounds; i += 1) {
        for (const entry of waiting.splice(0, waiting.length)) {
          entry.resolve();
        }
        await nextTick();
      }
    },
  };
}

export type ScriptedAdapter = {
  adapter: IngestAdapter;
  /** Resolves the pending `connect()`. */
  finishConnect(): void;
  /** Rejects the pending `connect()`. */
  failConnect(reason?: string): void;
  /** Pushes samples through the sink the supervisor attached. */
  emit(samples: readonly SourceSample[]): void;
  /** Resolves the in-flight `poll()`. */
  finishPoll(samples: readonly SourceSample[]): void;
  failPoll(reason?: string): void;
  setHealth(state: AdapterHealth["state"], detail?: string): void;
  readonly pollCalls: number;
  readonly inFlightPolls: number;
  readonly disconnects: number;
  readonly contexts: AdapterContext<unknown, unknown>[];
};

/** An adapter whose connect, poll, emit and health are driven by the test, not by time. */
export function makeScriptedAdapter(mode: "push" | "poll", options: { hangDisconnect?: boolean } = {}): ScriptedAdapter {
  let resolveConnect: (() => void) | null = null;
  let rejectConnect: ((error: Error) => void) | null = null;
  let sink: ((samples: readonly SourceSample[]) => void) | null = null;
  let resolvePoll: ((samples: readonly SourceSample[]) => void) | null = null;
  let rejectPoll: ((error: Error) => void) | null = null;
  let health: AdapterHealth = { state: "disconnected" };
  const state = { pollCalls: 0, inFlightPolls: 0, disconnects: 0 };
  const contexts: AdapterContext<unknown, unknown>[] = [];

  const base = {
    async connect(context: AdapterContext<unknown, unknown>) {
      contexts.push(context);
      await new Promise<void>((resolve, reject) => {
        resolveConnect = resolve;
        rejectConnect = reject;
      });
      health = { state: "connected" };
    },
    async disconnect() {
      state.disconnects += 1;
      if (options.hangDisconnect === true) {
        // Never settles — the case §5 says the supervisor abandons after 5 s.
        await new Promise<void>(() => undefined);
      }
    },
    health: () => health,
  };

  const adapter: IngestAdapter =
    mode === "push"
      ? {
          ...base,
          mode: "push",
          async subscribe(emit) {
            sink = emit;
          },
        }
      : {
          ...base,
          mode: "poll",
          defaultPollIntervalMs: 5_000,
          async poll() {
            state.pollCalls += 1;
            state.inFlightPolls += 1;
            try {
              return await new Promise<readonly SourceSample[]>((resolve, reject) => {
                resolvePoll = resolve;
                rejectPoll = reject;
              });
            } finally {
              state.inFlightPolls -= 1;
            }
          },
        };

  return {
    adapter,
    contexts,
    finishConnect: () => resolveConnect?.(),
    failConnect: (reason = "refused") => rejectConnect?.(new Error(reason)),
    emit: (samples) => sink?.(samples),
    finishPoll: (samples) => resolvePoll?.(samples),
    failPoll: (reason = "read failed") => rejectPoll?.(new Error(reason)),
    setHealth: (s, detail) => {
      health = detail === undefined ? { state: s } : { state: s, detail };
    },
    get pollCalls() {
      return state.pollCalls;
    },
    get inFlightPolls() {
      return state.inFlightPolls;
    },
    get disconnects() {
      return state.disconnects;
    },
  };
}

/** The two-binding MQTT endpoint every block starts from — the PHE broker's shape. */
export function makePlan(): EndpointPlan {
  return {
    protocol: "mqtt",
    endpointKey: "phe.thinkiot.co.in:8883",
    config: { host: "phe.thinkiot.co.in", port: 8883 },
    credentials: { username: "u", password: "p" },
    bindings: [
      { rtuId: "id-1", rtuCode: "RTU-1", deviceKey: "RTU-1", device: {}, sourceKeys: ["flow"] },
      { rtuId: "id-2", rtuCode: "RTU-2", deviceKey: "RTU-2", device: {}, sourceKeys: ["flow"] },
    ],
    pointIndex: new Map(),
  };
}

/** An endpoint serving exactly one device — the case that may omit `deviceKey`. */
export function makeSoleDevicePlan(): EndpointPlan {
  return {
    ...makePlan(),
    bindings: [
      { rtuId: "id-1", rtuCode: "RTU-1", deviceKey: "RTU-1", device: {}, sourceKeys: ["flow"] },
    ],
  };
}

/** A factory handing out the scripted instances in order, then repeating the last — one per restart. */
export function makeFactory(instances: ScriptedAdapter[]): IngestAdapterFactory {
  let index = 0;
  return {
    protocol: "mqtt",
    mode: "push",
    configSchema: z.unknown(),
    deviceSchema: z.unknown(),
    endpointKey: () => "phe.thinkiot.co.in:8883",
    create: () => {
      const instance = instances[Math.min(index, instances.length - 1)];
      index += 1;
      return instance.adapter;
    },
  };
}

export const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Stops a supervisor under the gated fake scheduler.
 *
 * `stop()` is deliberately bounded — a drain loop blocked on a write that never
 * settles must not hold shutdown open forever — and that bound is itself a
 * `sleep`. Under a scheduler whose sleeps resolve only on demand, `stop()`
 * therefore has to be flushed rather than simply awaited.
 *
 * That this helper is needed at all is the point: the first version of these
 * tests hung for five seconds against a `stop()` that awaited the drain loop
 * unconditionally, which is exactly what a hung `pg` write would have done to
 * the real process on shutdown.
 */
export async function stopSupervisor(
  supervisor: { stop(): Promise<void> },
  fake: { flush(rounds?: number): Promise<void> },
): Promise<void> {
  const stopping = supervisor.stop();
  await fake.flush(5);
  await stopping;
}

/** One well-formed `SourceSample`; the value is the identity an assertion reads back. */
export function sample(value: number, deviceKey = "RTU-1"): SourceSample {
  return { sourceKey: "flow", value, deviceKey };
}

/**
 * The disk tier, in memory, for the blocks that are not about the disk.
 *
 * `buffer` is a required dependency (Amendment 4 ruling 4: a host that cannot
 * buffer does not start), so every block needs one. This one keeps the same
 * contract the real store gives — `append` resolves `true`, `oldest()` hands
 * back what has been appended so far, and `commit()` removes only the batches
 * that call read — without touching a filesystem. `supervisor-buffer.spec.ts`
 * runs the real store for the blocks where the disk is the subject.
 */
export function makeMemoryBuffer(): DiskBufferHandle & { readonly appended: SourceSample[][] } {
  const appended: SourceSample[][] = [];
  return {
    protocol: "mqtt",
    endpointKey: "phe.thinkiot.co.in:8883",
    appended,
    get buffered() {
      return appended.reduce((total, batch) => total + batch.length, 0);
    },
    get dropped() {
      return 0;
    },
    append: async (samples) => {
      appended.push([...samples]);
      return true;
    },
    // Nothing here is bounded by age or bytes, so there is nothing to sweep.
    // The blocks that assert the once-a-minute sweep use a spy in
    // `supervisor-buffer.spec.ts`.
    sweep: async () => undefined,
    oldest: async () => {
      if (appended.length === 0) {
        return null;
      }
      const read = appended.length;
      return {
        samples: appended.flat(),
        // Only what this read saw is removed — the same rule the real store's
        // line-count check enforces when a segment grew after it was read.
        commit: async () => {
          appended.splice(0, read);
        },
      };
    },
  };
}

/** Per-endpoint supervision, ADR 0016 §5. */
export async function runSupervisorTests(): Promise<void> {
  // ---- push: samples reach the write path ---------------------------------

  {
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const written: SourceSample[][] = [];
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async (samples) => {
        written.push([...samples]);
      },
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    assert(supervisor.health().state === "connected", "a connected endpoint reports connected");
    // The context handed to the adapter carries everything, and nothing else.
    const context = scripted.contexts[0];
    assert(context.endpointKey === "phe.thinkiot.co.in:8883", "the endpoint key is passed through");
    assert(context.bindings.length === 2, "every binding on the endpoint is passed");
    assert(context.credentials.password === "p", "credentials are decrypted by the host");
    assert(context.signal.aborted === false, "the abort signal starts live");

    scripted.emit([sample(1), sample(2)]);
    await fake.flush();

    assert(written.length === 1, `one batch should have been written, got ${written.length}`);
    assert(written[0].length === 2, "both samples reached the write path");
    assert(supervisor.health().samplesWritten === 2, "the written count is reported");
    assert(supervisor.health().lastSampleAt !== undefined, "lastSampleAt is stamped — F3.16 reads it");
    assert(
      supervisor.health().devices.map((d) => d.rtuCode).join(",") === "RTU-1,RTU-2",
      "health enumerates the RTUs that share this connection (§5)",
    );

    // ---- `F1.7`: liveness is attributed per RTU, not per batch -------------
    //
    // Both samples above carry `deviceKey: "RTU-1"`. The endpoint's own
    // `lastSampleAt` is therefore fresh — and RTU-2, which shares the
    // connection and has published nothing, must NOT inherit that freshness.
    // Before this, one talkative RTU kept the only timestamp there was, and a
    // whole silent fleet behind it read as healthy.
    {
      const devices = supervisor.health().devices;
      const rtu1 = devices.find((d) => d.rtuCode === "RTU-1");
      const rtu2 = devices.find((d) => d.rtuCode === "RTU-2");
      assert(rtu1?.lastSampleAt !== undefined, "the RTU that published is stamped");
      assert(
        rtu2?.lastSampleAt === undefined,
        "an RTU that published nothing must not inherit its neighbour's timestamp",
      );
      // An RTU that has never published still has to appear, or health cannot
      // tell "silent" from "not configured".
      assert(devices.length === 2, "every bound RTU appears in health, silent or not");
    }

    scripted.emit([sample(3, "RTU-2")]);
    await fake.flush();
    assert(
      supervisor.health().devices.find((d) => d.rtuCode === "RTU-2")?.lastSampleAt !== undefined,
      "an RTU is stamped as soon as it publishes for itself",
    );

    // A sample for a device this endpoint has no binding for is dropped from
    // the liveness map, not recorded — otherwise a stray `dev_id` on a shared
    // topic would invent an RTU health reports on for ever.
    scripted.emit([sample(4, "RTU-UNBOUND")]);
    await fake.flush();
    assert(
      supervisor.health().devices.length === 2,
      "an unbound deviceKey must not add an RTU to health",
    );


    await stopSupervisor(supervisor, fake);
    assert(scripted.disconnects >= 1, "stop() disconnects the adapter");
  }

  // ---- `F1.7`: an omitted `deviceKey` on a MULTI-device endpoint credits nobody

  {
    // The normaliser refuses this sample as `ambiguousDevice` rather than
    // guessing. Liveness has to agree: crediting `bindings[0]` would keep a
    // dead first RTU reading fresh for ever, off a sample whose rows were
    // never written. Asserted on a supervisor that has seen nothing else, so
    // it holds without a clock — the fake scheduler's `now` is a constant, and
    // a before/after timestamp comparison here proves nothing.
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => {},
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    scripted.emit([{ sourceKey: "flow", value: 5 }]);
    await fake.flush();

    const devices = supervisor.health().devices;
    assert(devices.length === 2, "the endpoint still serves both RTUs");
    assert(
      devices.every((d) => d.lastSampleAt === undefined),
      `an ambiguous sample must credit neither RTU, got ${JSON.stringify(
        devices.map((d) => [d.rtuCode, d.lastSampleAt ?? null]),
      )}`,
    );

    await stopSupervisor(supervisor, fake);
  }

  // ---- `F1.7`: a sole-device endpoint may omit `deviceKey` ----------------

  {
    // `SourceSample.deviceKey` is "required when the instance has more than one
    // binding; omit when it has exactly one". Every polling adapter with one
    // gateway takes that option. If liveness ignored the omission, those
    // endpoints would write rows perfectly well and report stale for ever —
    // the same false alarm as the false all-clear, in the other direction.
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makeSoleDevicePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => {},
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    scripted.emit([{ sourceKey: "flow", value: 1 }]);
    await fake.flush();

    assert(
      supervisor.health().devices[0]?.lastSampleAt !== undefined,
      "a sample with no deviceKey credits the endpoint's only binding",
    );

    await stopSupervisor(supervisor, fake);
  }

  // ---- connect timeout, then backoff --------------------------------------

  {
    const first = makeScriptedAdapter("push");
    const second = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([first, second]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => undefined,
    });

    supervisor.start();
    await nextTick();
    // `connect()` is deliberately never resolved.
    assert(
      fake.delays.includes(30_000),
      `the connect timeout must be 30 s, saw ${fake.delays.join(",")}`,
    );

    await fake.flush(3);
    assert(
      supervisor.health().state === "disconnected",
      "a timed-out connect leaves the endpoint disconnected, not stuck at connected",
    );
    assert(
      fake.delays.includes(1_000),
      `the first retry must wait ~1 s, saw ${fake.delays.join(",")}`,
    );
    assert(supervisor.health().restarts >= 1, "the restart is counted");
    await stopSupervisor(supervisor, fake);
  }

  // ---- backoff doubles, and resets after a successful connect -------------

  {
    const failing = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([failing]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      // A short connect timeout keeps the delay list readable; the ratio is
      // what is under test, not the absolute connect timeout (asserted above).
      timings: { connectTimeoutMs: 10 },
      writeSamples: async () => undefined,
    });

    supervisor.start();
    for (let i = 0; i < 5; i += 1) {
      await nextTick();
      failing.failConnect();
      await fake.flush(2);
    }
    const backoffs = fake.delays.filter((ms) => [1_000, 2_000, 4_000, 8_000, 16_000].includes(ms));
    assert(
      backoffs.slice(0, 3).join(",") === "1000,2000,4000",
      `backoff must double: saw ${backoffs.join(",")} within ${fake.delays.join(",")}`,
    );
    await stopSupervisor(supervisor, fake);
  }

  {
    // A clean reconnect after an outage should retry in one second next time,
    // not sixty — otherwise a flapping endpoint stays punished for its history.
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      // Every other cadence is given a distinctive value so that a 1000 in the
      // delay list can *only* have come from the backoff. With the defaults,
      // `healthPollMs` is also 1000 — and the first version of this assertion
      // was satisfied by the health poll whether the backoff reset or not.
      timings: { connectTimeoutMs: 10, healthPollMs: 7, drainIdleMs: 3 },
      writeSamples: async () => undefined,
    });

    supervisor.start();
    // Two failures, so without a reset the next backoff would be 4 s.
    for (let i = 0; i < 2; i += 1) {
      await nextTick();
      scripted.failConnect();
      await fake.flush(2);
    }
    const before = fake.delays.length;
    // Now succeed, then lose the transport.
    await nextTick();
    scripted.finishConnect();
    await nextTick();
    scripted.setHealth("disconnected", "broker closed");
    await fake.flush(3);

    const after = fake.delays.slice(before);
    assert(
      after.includes(1_000),
      `after a successful connect the backoff must reset to ~1 s, saw ${after.join(",")}`,
    );
    assert(
      !after.includes(4_000),
      `the backoff must not continue from where it left off, saw ${after.join(",")}`,
    );
    await stopSupervisor(supervisor, fake);
  }

  // ---- poll: never overlaps ------------------------------------------------

  {
    const scripted = makeScriptedAdapter("poll");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => undefined,
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    assert(scripted.pollCalls === 1, `poll must start once, got ${scripted.pollCalls}`);
    // Flushing every pending sleep must NOT start a second read while the first
    // is in flight — "next tick is scheduled only after poll() settles" (§5).
    await fake.flush(3);
    assert(
      scripted.pollCalls === 1,
      `poll must not overlap: ${scripted.pollCalls} calls while one was in flight`,
    );
    assert(scripted.inFlightPolls === 1, "exactly one read is outstanding");

    scripted.finishPoll([sample(1)]);
    await nextTick();
    await fake.flush();
    assert(scripted.pollCalls === 2, "the next read starts only after the first settles");
    assert(
      fake.delays.includes(5_000),
      `the poll cadence must come from defaultPollIntervalMs, saw ${fake.delays.join(",")}`,
    );
    await stopSupervisor(supervisor, fake);
  }

  // ---- poll: three consecutive failures mark degraded ---------------------

  {
    const scripted = makeScriptedAdapter("poll");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => undefined,
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    for (let i = 1; i <= 2; i += 1) {
      scripted.failPoll();
      await nextTick();
      await fake.flush();
      assert(
        supervisor.health().state !== "degraded",
        `${i} failure(s) must not yet be degraded — the threshold is 3 (§5)`,
      );
    }
    scripted.failPoll();
    await nextTick();
    assert(
      supervisor.health().state === "degraded",
      `three consecutive poll failures must report degraded, got ${supervisor.health().state}`,
    );
    assert(supervisor.health().consecutivePollFailures === 3, "the failure run is reported");

    // A successful read clears it.
    await fake.flush();
    scripted.finishPoll([sample(1)]);
    await nextTick();
    assert(supervisor.health().state === "connected", "one good read clears the degraded state");
    assert(supervisor.health().consecutivePollFailures === 0, "the failure run resets");
    await stopSupervisor(supervisor, fake);
  }

  // ---- a hung disconnect is abandoned, not waited on ----------------------

  {
    const scripted = makeScriptedAdapter("push", { hangDisconnect: true });
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => undefined,
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();
    scripted.setHealth("disconnected", "broker closed");

    await fake.flush(2);
    assert(
      fake.delays.includes(5_000),
      `a hung disconnect must be abandoned after 5 s, saw ${fake.delays.join(",")}`,
    );
    // The endpoint must still restart despite the adapter refusing to close.
    await fake.flush(3);
    assert(supervisor.health().restarts >= 1, "a hung disconnect must not block the restart");
    await stopSupervisor(supervisor, fake);
  }

  // ---- a write failure spills to disk and is probed, not retried in a loop -

  {
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    let attempts = 0;
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      // Every other cadence is distinctive, so a 1000 in the delay list can
      // only be the §5 backoff — `healthPollMs` is 1000 by default.
      timings: { connectTimeoutMs: 10, healthPollMs: 7, drainIdleMs: 3 },
      writeSamples: async () => {
        attempts += 1;
        throw new Error("database unreachable");
      },
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();
    scripted.emit([sample(1)]);
    await fake.flush(1);

    assert(supervisor.health().writeFailures === 1, "a failed write is counted");
    assert(
      attempts === 1,
      `a failed batch must not be retried in a tight loop, got ${attempts} attempts`,
    );
    assert(
      supervisor.health().buffered === 1,
      `the failed batch is on the disk tier, not lost: buffered ${supervisor.health().buffered}`,
    );
    assert(supervisor.health().samplesWritten === 0, "a failed batch is not counted as written");

    // The retry is the replay loop's probe, one §5 backoff later — and it is a
    // real write of the buffered batch, not a separate liveness query
    // (Amendment 4 decision 4).
    await fake.flush(1);
    assert(
      fake.delays.includes(1_000),
      `the probe must wait the §5 base delay, saw ${fake.delays.join(",")}`,
    );
    assert(attempts === 2, `the probe must be a real write, got ${attempts} attempts`);
    assert(
      supervisor.health().buffered === 1,
      "a failed probe leaves the segment on disk, uncommitted",
    );
    await stopSupervisor(supervisor, fake);
  }

  // ---- backpressure: the queue is bounded and drops are counted -----------

  {
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      timings: { queueCapacity: 10 },
      // Never settles, so the drain loop cannot keep up — the database-outage
      // shape that the bounded queue exists to survive.
      writeSamples: () => new Promise<void>(() => undefined),
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();

    for (let i = 0; i < 100; i += 1) {
      scripted.emit([sample(i)]);
    }
    const filling = supervisor.health();
    assert(
      filling.queueDepth <= 10,
      `the queue must stay bounded, got depth ${filling.queueDepth}`,
    );
    assert(
      filling.droppedSamples === 90,
      `the ninety samples the ring dropped are counted — the memory tier's own ` +
        `loss, before anything reaches the write path, got ${filling.droppedSamples}`,
    );

    // The old assertion here read `buffered === 0` from a snapshot taken with
    // no intervening flush, so it could not fail, and the comment beside it —
    // "a write that never settles never throws, so nothing spills" — was
    // false. `withTimeout` rejects after `writeTimeoutMs` and the batch spills
    // like any other failure. Flushing past the timeout is what makes this an
    // assertion: the memory tier's loss is the 90 the ring dropped, and what
    // the drain loop did manage to take is on disk, not lost.
    for (let round = 0; round < 10 && supervisor.health().writeFailures === 0; round += 1) {
      await fake.flush(1);
    }
    const health = supervisor.health();
    assert(
      health.writeFailures === 1,
      `the hung write fails once, on the writeTimeoutMs ceiling, got ${health.writeFailures}`,
    );
    assert(
      health.buffered === 10,
      `the batch the drain loop took spills whole — the ten the ring still ` +
        `held — got buffered ${health.buffered}`,
    );
    assert(
      health.droppedSamples === 90,
      `and the spill adds nothing to the memory tier's loss, got ${health.droppedSamples}`,
    );
    await stopSupervisor(supervisor, fake);
  }

  // ---- late samples from a non-conforming adapter are refused -------------

  {
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const written: SourceSample[][] = [];
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async (samples) => {
        written.push([...samples]);
      },
    });

    supervisor.start();
    await nextTick();
    scripted.finishConnect();
    await nextTick();
    await stopSupervisor(supervisor, fake);

    // §5 rule 8 forbids this and the conformance suite catches it, but one
    // non-conforming adapter must not be able to write through a supervisor
    // that has already stopped.
    scripted.emit([sample(99)]);
    await fake.flush(2);
    const total = written.reduce((n, batch) => n + batch.length, 0);
    assert(total === 0, `samples emitted after stop() must be refused, wrote ${total}`);
    // Asserting "nothing was written" alone is satisfied by the drain loop
    // having already exited, whether or not the sample was refused. The queue
    // depth is what distinguishes *refused at the door* from *quietly retained*
    // — and a retained sample would be written by the next supervisor to run.
    assert(
      supervisor.health().queueDepth === 0,
      `a late sample must be refused, not queued: depth ${supervisor.health().queueDepth}`,
    );
  }

  // ---- start() is idempotent ----------------------------------------------

  {
    const scripted = makeScriptedAdapter("push");
    const fake = makeFakeScheduler();
    const supervisor = createSupervisor({
      factory: makeFactory([scripted]),
      plan: makePlan(),
      logger: silentLogger,
      buffer: makeMemoryBuffer(),
      scheduler: fake.scheduler,
      random: () => 0.5,
      writeSamples: async () => undefined,
    });
    supervisor.start();
    supervisor.start();
    supervisor.start();
    await nextTick();
    assert(
      scripted.contexts.length === 1,
      `start() must not open a second connection, got ${scripted.contexts.length}`,
    );
    await stopSupervisor(supervisor, fake);
    await stopSupervisor(supervisor, fake);
  }
}
