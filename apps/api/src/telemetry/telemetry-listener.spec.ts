import { getEventListeners } from "node:events";

import type { TelemetryReading } from "@bms/shared";

import {
  createTelemetryListener,
  DEFAULT_STABLE_MS,
  parseNotification,
  type ListenerClient,
  type ListenerNotification,
  type ListenerState,
} from "./telemetry-listener";
import { backoffDelayMs, DEFAULT_BACKOFF } from "@bms/shared";

import { buildListenerDeps } from "./telemetry-notify.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lets the listener loop advance past its pending microtasks and timers. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Fake = {
  client: ListenerClient;
  queries: string[];
  connects: number;
  ends: number;
  /** Registration order, so "was `error` attached before `connect()`" is checkable. */
  events: string[];
  emitError(err: Error): void;
  emitEnd(): void;
  emitNotification(payload: string | undefined): void;
};

/**
 * A `pg.Client` stand-in.
 *
 * `emitError` **throws when no handler is registered**, which is not test
 * theatre — `pg.Client` is an `EventEmitter` and an `error` event with no
 * listener really does throw. Modelling that is what makes the
 * "handler attached before connect" test meaningful rather than decorative.
 */
function makeFake(options: { failConnect?: string } = {}): Fake {
  const handlers: {
    notification?: (msg: ListenerNotification) => void;
    error?: (err: Error) => void;
    end?: () => void;
  } = {};
  const fake: Fake = {
    queries: [],
    connects: 0,
    ends: 0,
    events: [],
    client: {
      async connect(): Promise<void> {
        fake.connects += 1;
        fake.events.push("connect");
        if (options.failConnect !== undefined) {
          throw new Error(options.failConnect);
        }
      },
      async query(sql: string): Promise<unknown> {
        fake.queries.push(sql);
        return undefined;
      },
      on(event: string, listener: unknown): unknown {
        fake.events.push(event);
        if (event === "notification") {
          handlers.notification = listener as (msg: ListenerNotification) => void;
        } else if (event === "error") {
          handlers.error = listener as (err: Error) => void;
        } else if (event === "end") {
          handlers.end = listener as () => void;
        }
        return fake.client;
      },
      async end(): Promise<void> {
        fake.ends += 1;
      },
    } as unknown as ListenerClient,
    emitError(err: Error): void {
      if (handlers.error === undefined) {
        throw new Error("unhandled 'error' event: no listener registered");
      }
      handlers.error(err);
    },
    emitEnd(): void {
      handlers.end?.();
    },
    emitNotification(payload: string | undefined): void {
      handlers.notification?.({ payload });
    },
  };
  return fake;
}

type Harness = {
  listener: ReturnType<typeof createTelemetryListener>;
  fakes: Fake[];
  delays: number[];
  states: ListenerState[];
  logs: string[];
  batches: TelemetryReading[][];
  reconnectSignals: number;
};

function makeHarness(
  fakes: Fake[],
  options: {
    onReadings?: () => void;
    clock?: { value: number };
    captureSignal?: (signal: AbortSignal) => void;
  } = {},
): Harness {
  const delays: number[] = [];
  const states: ListenerState[] = [];
  const logs: string[] = [];
  const batches: TelemetryReading[][] = [];
  let reconnectSignals = 0;
  let index = 0;

  const listener = createTelemetryListener({
    createClient() {
      const fake = fakes[Math.min(index, fakes.length - 1)];
      index += 1;
      return fake.client;
    },
    onReadings(readings) {
      batches.push(readings);
      options.onReadings?.();
    },
    logger: {
      log: (m) => logs.push(`log:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
    async sleep(ms, signal) {
      delays.push(ms);
      // The loop hands its own `stopController.signal` here, which is the only
      // way a test can reach it — and reaching it is what makes the abort-leak
      // assertion a real count rather than a hope that Node emits a warning.
      options.captureSignal?.(signal);
      // Yields a **macrotask**, not just a microtask. The loop is otherwise all
      // promises, so a `sleep` that resolves synchronously starves the timer
      // queue and `flush`'s `setTimeout` never fires — the whole suite
      // deadlocks. Found the hard way.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    random: () => 0.5,
    now: () => options.clock?.value ?? 0,
    onStateChange: (state) => states.push(state),
    onReconnectAttempt: () => {
      reconnectSignals += 1;
    },
  });

  const harness: Harness = {
    listener,
    fakes,
    delays,
    states,
    logs,
    batches,
    get reconnectSignals(): number {
      return reconnectSignals;
    },
  } as Harness;
  return harness;
}

/** The whole point of `F4.34`: a lost connection comes back. */
async function reconnectsAfterConnectionError(): Promise<void> {
  const fakes = [makeFake(), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();

  assert(fakes[0].connects === 1, "first client should have connected");
  assert(
    fakes[0].queries.includes("LISTEN bms_telemetry"),
    "first client should have issued LISTEN",
  );
  assert(h.listener.connected(), "listener should report connected");

  fakes[0].emitError(new Error("Connection terminated unexpectedly"));
  await flush();

  assert(fakes[1].connects === 1, "a second client should have connected after the error");
  assert(
    fakes[1].queries.includes("LISTEN bms_telemetry"),
    "re-LISTEN must be issued on reconnect, or the socket is live and deaf",
  );
  assert(h.listener.reconnects() === 1, "one reconnect should be counted");
  assert(h.listener.connected(), "listener should be connected again");

  await h.listener.stop();
}

/**
 * The handler must exist before `connect()`.
 *
 * Registering it afterwards leaves a window in which a handshake failure hits an
 * emitter with no listener, which throws rather than reconnecting.
 */
async function attachesErrorHandlerBeforeConnect(): Promise<void> {
  const fakes = [makeFake(), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();

  const errorAt = fakes[0].events.indexOf("error");
  const connectAt = fakes[0].events.indexOf("connect");
  assert(errorAt >= 0, "an error handler must be registered");
  assert(
    errorAt < connectAt,
    `error handler must be attached before connect() (error at ${errorAt}, connect at ${connectAt})`,
  );

  await h.listener.stop();
}

/** A failure during `connect()` must be caught, logged with its real text, and retried. */
async function recoversFromConnectFailure(): Promise<void> {
  const fakes = [makeFake({ failConnect: "ECONNREFUSED 127.0.0.1:5432" }), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();

  assert(
    h.logs.some((l) => l.startsWith("error:") && l.includes("ECONNREFUSED 127.0.0.1:5432")),
    `the underlying error text must survive into the log, got ${JSON.stringify(h.logs)}`,
  );
  assert(fakes[1].connects === 1, "the listener should have retried with a new client");
  assert(h.listener.connected(), "the retry should have succeeded");

  await h.listener.stop();
}

/** A clean `end` event is a loss like any other. */
async function reconnectsAfterEndEvent(): Promise<void> {
  const fakes = [makeFake(), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();

  fakes[0].emitEnd();
  await flush();

  assert(fakes[1].connects === 1, "an 'end' event should trigger a reconnect");
  await h.listener.stop();
}

/** Backoff grows, and a successful connect resets it. */
async function backoffGrowsAndResets(): Promise<void> {
  const fakes = [
    makeFake({ failConnect: "down" }),
    makeFake({ failConnect: "down" }),
    makeFake({ failConnect: "down" }),
  ];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush(12);

  assert(h.delays.length >= 3, `expected several retries, got ${h.delays.length}`);
  assert(
    h.delays[1] > h.delays[0] && h.delays[2] > h.delays[1],
    `delays must grow, got ${JSON.stringify(h.delays.slice(0, 3))}`,
  );
  await h.listener.stop();

  // A connection that *held* resets the exponent, so the next failure retries
  // from the base rather than continuing to climb.
  const clock = { value: 5_000_000 };
  const recovering = [makeFake(), makeFake(), makeFake()];
  const h2 = makeHarness(recovering, { clock });
  h2.listener.start();
  await flush();
  clock.value += DEFAULT_STABLE_MS + 1;
  recovering[0].emitError(new Error("first loss"));
  await flush();
  const firstDelay = h2.delays[0];
  clock.value += DEFAULT_STABLE_MS + 1;
  recovering[1].emitError(new Error("second loss"));
  await flush();
  assert(
    h2.delays[1] === firstDelay,
    `a connection that held must reset backoff (${h2.delays[1]} vs ${firstDelay})`,
  );
  await h2.listener.stop();
}

/**
 * The flap the security review found: a peer that accepts and immediately drops
 * must still escalate.
 *
 * Resetting the exponent the moment `LISTEN` returns looks correct and is not —
 * pgbouncer at its pool limit, or a replica in recovery, would pin the retry
 * rate at the ~1 s floor indefinitely. Without the stability window this test
 * sees a flat delay sequence instead of a growing one.
 */
async function acceptThenDropStillEscalates(): Promise<void> {
  // Non-zero start: a clock reading of 0 used to alias with the "never
  // connected" sentinel, which hid the very defect this test guards.
  const clock = { value: 5_000_000 };
  const fakes = [makeFake(), makeFake(), makeFake(), makeFake()];
  const h = makeHarness(fakes, { clock });
  h.listener.start();
  await flush();

  // Each connection succeeds, then dies immediately — the clock never advances,
  // so no connection ever reaches DEFAULT_STABLE_MS.
  for (const fake of fakes) {
    fake.emitError(new Error("dropped immediately"));
    await flush(4);
  }

  assert(h.delays.length >= 3, `expected several retries, got ${h.delays.length}`);
  assert(
    h.delays[1] > h.delays[0] && h.delays[2] > h.delays[1],
    `an accept-then-drop flap must still escalate, got ${JSON.stringify(h.delays.slice(0, 3))}`,
  );

  await h.listener.stop();
}

/**
 * The abort listener must not accumulate one per reconnect.
 *
 * `stopController` lives as long as the process while `waitForLoss` runs once
 * per iteration, so a registration without removal leaks in proportion to
 * database availability — and eventually prints `MaxListenersExceededWarning`
 * from somewhere that looks unrelated.
 */
async function doesNotLeakAbortListeners(): Promise<void> {
  let signal: AbortSignal | null = null;
  const fakes = Array.from({ length: 12 }, () => makeFake());
  const h = makeHarness(fakes, {
    captureSignal: (s) => {
      signal = s;
    },
  });

  h.listener.start();
  await flush();
  for (const fake of fakes) {
    fake.emitError(new Error("cycle"));
    await flush(3);
  }

  assert(
    h.listener.reconnects() >= 10,
    `test needs enough cycles to be meaningful, got ${h.listener.reconnects()}`,
  );
  assert(signal !== null, "the loop should have handed its stop signal to sleep()");

  // Counted, not inferred. Relying on Node's MaxListenersExceededWarning was the
  // first attempt and it never fired for an AbortSignal, so the leak mutation
  // survived a test that looked like it covered it.
  const listeners = getEventListeners(signal as unknown as AbortSignal, "abort").length;
  assert(
    listeners <= 1,
    `abort listeners accumulated across ${h.listener.reconnects()} reconnects: ${listeners}`,
  );

  await h.listener.stop();
}

/** The §5 table, and the cap being a hard ceiling rather than cap × 1.2. */
function backoffPolicyHoldsItsCeiling(): void {
  const max = () => 1;
  const min = () => 0;
  assert(
    backoffDelayMs(0, () => 0.5) === DEFAULT_BACKOFF.baseMs,
    "mid-jitter first retry should equal baseMs",
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const high = backoffDelayMs(attempt, max);
    const low = backoffDelayMs(attempt, min);
    assert(
      high <= DEFAULT_BACKOFF.capMs,
      `attempt ${attempt} exceeded the cap: ${high}`,
    );
    assert(low >= 0, `attempt ${attempt} produced a negative delay: ${low}`);
  }
  assert(
    backoffDelayMs(50, max) === DEFAULT_BACKOFF.capMs,
    "a far-out attempt should sit exactly at the cap, not above it",
  );
}

/** `stop()` must end the loop rather than let it reconnect forever. */
async function stopHaltsTheLoop(): Promise<void> {
  const fakes = [makeFake(), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();
  await h.listener.stop();

  const connectsAfterStop = fakes[1].connects;
  fakes[0].emitError(new Error("late error"));
  await flush();

  assert(
    fakes[1].connects === connectsAfterStop,
    "no reconnect may happen after stop()",
  );
  assert(!h.listener.connected(), "a stopped listener must report disconnected");
}

/** Payload handling, including the two shapes that must not kill the loop. */
async function survivesBadPayloads(): Promise<void> {
  assert(parseNotification("{ not json") === null, "malformed JSON should parse to null");
  assert(parseNotification(undefined) === null, "an absent payload should parse to null");
  assert(parseNotification('{"readings":"nope"}') === null, "a non-array should parse to null");
  assert(
    parseNotification('{"readings":[]}')?.length === 0,
    "an empty readings array is valid and empty",
  );

  const fakes = [makeFake()];
  const h = makeHarness(fakes, {
    onReadings: () => {
      throw new Error("hub exploded");
    },
  });
  h.listener.start();
  await flush();

  fakes[0].emitNotification("{ not json");
  fakes[0].emitNotification('{"readings":[{"pointKey":"kw"}]}');
  await flush();

  assert(
    h.logs.some((l) => l.includes("Failed to parse")),
    "a malformed payload should be logged",
  );
  assert(
    h.logs.some((l) => l.includes("hub exploded")),
    "a throwing consumer should be logged with its real message",
  );
  assert(h.listener.connected(), "neither failure may take the listener down");

  await h.listener.stop();
}

/** State transitions are what the Prometheus gauge is driven from. */
async function reportsStateTransitions(): Promise<void> {
  const fakes = [makeFake(), makeFake()];
  const h = makeHarness(fakes);
  h.listener.start();
  await flush();
  fakes[0].emitError(new Error("boom"));
  await flush();

  assert(
    h.states.length >= 3 && h.states[0] === "connected" && h.states[1] === "disconnected",
    `expected connected → disconnected → connected, got ${JSON.stringify(h.states)}`,
  );
  assert(h.reconnectSignals === 1, "one reconnect attempt should have been signalled");

  await h.listener.stop();
}

/**
 * The wiring that drives the Prometheus gauge.
 *
 * Exists because a mutation deleting the `onStateChange` hook outright left the
 * whole suite green: the tests above cover the listener, and nothing covered
 * the service that connects it to `MetricsService`. The gauge is the visible
 * half of `F4.34`, so it gets a guard rather than a comment.
 */
async function wiresMetricsToListenerState(): Promise<void> {
  const gauge: boolean[] = [];
  const reconnects: number[] = [];
  const emitted: TelemetryReading[][] = [];

  const deps = buildListenerDeps({
    createClient: () => makeFake().client,
    hub: {
      emitReadings: (readings: TelemetryReading[]) => {
        emitted.push(readings);
      },
    },
    metrics: {
      setTelemetryListenerConnected: (connected: boolean) => gauge.push(connected),
      countTelemetryListenerReconnect: () => reconnects.push(1),
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert(deps.onStateChange !== undefined, "state changes must be wired to the gauge");
  assert(deps.onReconnectAttempt !== undefined, "reconnects must be wired to the counter");

  deps.onStateChange?.("connected");
  deps.onStateChange?.("disconnected");
  assert(
    gauge.length === 2 && gauge[0] === true && gauge[1] === false,
    `gauge should follow listener state, got ${JSON.stringify(gauge)}`,
  );

  deps.onReconnectAttempt?.();
  assert(reconnects.length === 1, "a reconnect attempt should increment the counter");

  deps.onReadings([{ pointKey: "kw" } as unknown as TelemetryReading]);
  assert(emitted.length === 1, "readings should reach the broadcast hub");
}

/** Entry point for the sibling `.test.ts` (ADR 0014). */
export async function runTelemetryListenerTests(): Promise<void> {
  await wiresMetricsToListenerState();
  await reconnectsAfterConnectionError();
  await attachesErrorHandlerBeforeConnect();
  await recoversFromConnectFailure();
  await reconnectsAfterEndEvent();
  await backoffGrowsAndResets();
  await acceptThenDropStillEscalates();
  await doesNotLeakAbortListeners();
  backoffPolicyHoldsItsCeiling();
  await stopHaltsTheLoop();
  await survivesBadPayloads();
  await reportsStateTransitions();
}
