import {
  createNotifyListener,
  type ListenerState,
  type NotifyListener,
} from "./notify-listener";
import {
  flushListener,
  makeFakeListenerClient,
  type FakeListenerClient,
} from "../testing/fake-listener-client";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.11` / ADR 0064 Amendment 1 A2 — the generic `LISTEN` loop.
 *
 * The loop's own behaviour (reconnect, backoff reset, the abort-listener
 * count, `error` before `connect`) is gated by `telemetry-listener.spec.ts`
 * through the adapter, unchanged byte for byte. These rows cover only what
 * the extraction added: the `channel` parameter is read, not a literal that
 * survived the move; the handler's throw is caught by the loop and not by
 * the caller; and a channel that is not a bare identifier is refused before
 * a client exists. One exported function per row, one `it()` per row.
 */

type Harness = {
  listener: NotifyListener;
  logs: string[];
  states: ListenerState[];
  payloads: (string | undefined)[];
};

function makeHarness(
  channel: string,
  fakes: FakeListenerClient[],
  options: { onNotification?: (payload: string | undefined) => void } = {},
): Harness {
  const logs: string[] = [];
  const states: ListenerState[] = [];
  const payloads: (string | undefined)[] = [];
  let index = 0;
  const listener = createNotifyListener({
    channel,
    createClient() {
      const fake = fakes[Math.min(index, fakes.length - 1)];
      index += 1;
      return fake.client;
    },
    onNotification(payload) {
      payloads.push(payload);
      options.onNotification?.(payload);
    },
    logger: {
      log: (m) => logs.push(`log:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
    async sleep() {
      // A macrotask, not a microtask — see `telemetry-listener.spec.ts` for
      // why a synchronous `sleep` deadlocks the loop against `flush`.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    random: () => 0.5,
    now: () => 0,
    onStateChange: (state) => states.push(state),
  });
  return { listener, logs, states, payloads };
}

/** The one statement the parameter decides: `LISTEN <channel>`, bare. */
export async function assertListensOnTheChannelItWasGiven(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeHarness("bms_alarms", [fake]);
  h.listener.start();
  await flushListener();

  assert(fake.connects === 1, "the client should have connected");
  assert(
    fake.queries.length === 1 && fake.queries[0] === "LISTEN bms_alarms",
    `the query after connect must be exactly "LISTEN bms_alarms", got ${JSON.stringify(fake.queries)}`,
  );

  await h.listener.stop();
}

/**
 * Positive control for the row above: the same loop with the telemetry
 * channel issues the telemetry statement. A literal `bms_telemetry` that
 * survived the extraction passes this row and fails the one above; a literal
 * `bms_alarms` does the reverse. Together they prove the parameter is read.
 */
export async function assertListensOnTheTelemetryChannelWhenGivenIt(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeHarness("bms_telemetry", [fake]);
  h.listener.start();
  await flushListener();

  assert(
    fake.queries.length === 1 && fake.queries[0] === "LISTEN bms_telemetry",
    `the query after connect must be exactly "LISTEN bms_telemetry", got ${JSON.stringify(fake.queries)}`,
  );

  await h.listener.stop();
}

/**
 * A handler that throws is logged once and changes nothing else: the client
 * stays subscribed and the next notification still reaches the handler. This
 * is the "never fatal" `try/catch` that guarded `onReadings` before the
 * extraction, now guarding `onNotification`.
 */
export async function assertAThrowingHandlerIsWarnedOnceAndTheLoopStaysUp(): Promise<void> {
  const fake = makeFakeListenerClient();
  let calls = 0;
  const h = makeHarness("bms_alarms", [fake], {
    onNotification: () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("handler exploded");
      }
    },
  });
  h.listener.start();
  await flushListener();

  fake.emitNotification("first");
  fake.emitNotification("second");
  await flushListener();

  const warns = h.logs.filter((l) => l.startsWith("warn:"));
  assert(
    warns.length === 1 && warns[0].includes("handler exploded"),
    `one warn carrying the handler's message, got ${JSON.stringify(h.logs)}`,
  );
  assert(h.listener.connected(), "a throwing handler must not take the listener down");
  assert(
    h.payloads.length === 2 && h.payloads[1] === "second",
    `the second notification must still be delivered, got ${JSON.stringify(h.payloads)}`,
  );
  assert(fake.connects === 1, "no reconnect may follow a handler throw");

  await h.listener.stop();
}

/**
 * `LISTEN` takes no bind parameter, so the channel is interpolated into the
 * statement. The only defence is a guard on what may be interpolated: a bare
 * lowercase identifier, refused synchronously — before `start()`, before any
 * client is created — so a misnamed channel is a boot failure, not a runtime
 * one, and no string with a quote, a space or a semicolon ever reaches
 * `query()`.
 */
export function assertRefusesAChannelThatIsNotABareIdentifier(): void {
  let created = 0;
  let thrown: unknown = null;
  try {
    createNotifyListener({
      channel: 'bms_alarms"; DROP TABLE bms.alarms; --',
      createClient() {
        created += 1;
        return makeFakeListenerClient().client;
      },
      onNotification() {},
      logger: { log() {}, warn() {}, error() {} },
      async sleep() {},
    });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, "a non-identifier channel must throw at construction");
  assert(created === 0, "no client may be created for a refused channel");
}
