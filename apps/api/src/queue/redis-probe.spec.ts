import type { RedisConnectionOptions } from "./queue-config";
import {
  probeRedis,
  REDIS_PROBE_TIMEOUT_MS,
  type ProbeConnection,
  type ProbeConnectionOptions,
} from "./redis-probe";

/**
 * F4.24 (ADR 0063 decision 9) — the worker's bounded Redis reachability
 * probe, added by the 2026-09-11 review (Blocker A): with `REDIS_URL` set to
 * a closed port the worker wrote no stderr line and never exited, because
 * BullMQ's `queue.client` awaits an ioredis connection that retries forever.
 *
 * Assertions live here; `redis-probe.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). `open` is a recording fake whose `client` promise the row
 * controls — resolved, rejected, or never settled — so every branch of the
 * race is driven, not waited for. Errors are matched on `err.name`, never
 * `instanceof` (F4.108).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The "expected to reject" sentinel lives outside the `try` (Unit 1's lesson). */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CONNECTION: RedisConnectionOptions = { host: "cache", port: 6380, password: "s3cret", db: 2 };

type Fixture = {
  opened: ProbeConnectionOptions[];
  errorListeners: ((err: Error) => void)[];
  closed: number;
  open: (options: ProbeConnectionOptions) => ProbeConnection;
};

/** A fake `open` whose `client` promise is whatever the row hands it. */
function makeFixture(client: Promise<unknown>): Fixture {
  const fixture: Fixture = {
    opened: [],
    errorListeners: [],
    closed: 0,
    open: (options) => {
      fixture.opened.push(options);
      return {
        client,
        on: (event: "error", listener: (err: Error) => void) => {
          if (event === "error") {
            fixture.errorListeners.push(listener);
          }
          return undefined;
        },
        close: async () => {
          fixture.closed += 1;
        },
      };
    },
  };
  return fixture;
}

const PONG = { ping: async () => "PONG" };

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function assertProbeResolvesOnPong(): Promise<void> {
  const fixture = makeFixture(Promise.resolve(PONG));
  await probeRedis(CONNECTION, { open: fixture.open });
  assert(fixture.closed === 1, `expected the probe connection closed exactly once, got ${fixture.closed}`);
}

export async function assertProbeOpensWithTheParsedConnectionAndTheThreeProbeOptions(): Promise<void> {
  const fixture = makeFixture(Promise.resolve(PONG));
  await probeRedis(CONNECTION, { open: fixture.open });
  assert(fixture.opened.length === 1, `expected open() once, got ${fixture.opened.length}`);
  const expected = {
    ...CONNECTION,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  };
  assert(
    JSON.stringify(fixture.opened[0]) === JSON.stringify(expected),
    `expected open() to receive the parsed connection plus lazyConnect/maxRetriesPerRequest 1/enableOfflineQueue false, ` +
      `got ${JSON.stringify(fixture.opened[0])}`,
  );
}

export async function assertProbeRegistersAnErrorListener(): Promise<void> {
  const fixture = makeFixture(Promise.resolve(PONG));
  await probeRedis(CONNECTION, { open: fixture.open });
  assert(
    fixture.errorListeners.length === 1,
    `expected exactly one on("error") listener on the probe connection, got ${fixture.errorListeners.length} — ` +
      "an unhandled error event from a refused connect would throw instead of losing the race",
  );
}

/**
 * The traced shape against `redis://127.0.0.1:1` with `lazyConnect`: an
 * `error` event carrying `ECONNREFUSED`, then a *second* `error` event with
 * the code-less `Connection is closed.` BullMQ re-emits from its own init
 * failure, then the `client` rejection with that same code-less error. The
 * message must name the code from the coded event — not the last event, and
 * not the rejection.
 */
export async function assertProbeNamesTheLastCodedErrorEventWhenTheRejectionHasNoCode(): Promise<void> {
  let rejectClient: (err: Error) => void = () => undefined;
  const client = new Promise<unknown>((_, reject) => {
    rejectClient = reject;
  });
  const fixture = makeFixture(client);
  const probe = captureRejection(() => probeRedis(CONNECTION, { open: fixture.open }));
  // The listener is registered synchronously by probeRedis before the await.
  const listener = fixture.errorListeners[0];
  assert(listener !== undefined, "precondition: the error listener was registered");
  listener?.(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }));
  listener?.(new Error("Connection is closed."));
  rejectClient(new Error("Connection is closed."));
  const err = await probe;
  assert(
    errorMessage(err).includes("ECONNREFUSED"),
    `expected the message to carry the code from the coded error event, got "${errorMessage(err)}" — ` +
      "the code-less second event must not overwrite it",
  );
}

export async function assertProbeRejectsWithinTheTimeoutWhenTheClientNeverSettles(): Promise<void> {
  const fixture = makeFixture(new Promise<unknown>(() => undefined));
  const started = Date.now();
  const err = await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open, timeoutMs: 20 }));
  const elapsed = Date.now() - started;
  assert(
    errorName(err) === "QueueConfigError",
    `expected QueueConfigError when the client never settles, got ${errorName(err)}`,
  );
  assert(
    errorMessage(err).includes("did not answer PING within 20 ms"),
    `expected the message to name the bound, got "${errorMessage(err)}"`,
  );
  assert(elapsed < 2_000, `expected the probe to give up on the timer (20 ms), it took ${elapsed} ms`);
}

export async function assertProbeClosesTheConnectionAfterATimeout(): Promise<void> {
  const fixture = makeFixture(new Promise<unknown>(() => undefined));
  await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open, timeoutMs: 20 }));
  assert(
    fixture.closed === 1,
    `expected the still-initialising connection closed once after the timeout, got ${fixture.closed} — a leaked socket keeps the loop alive`,
  );
}

export async function assertProbeRejectsNamingTheCauseCodeWhenTheConnectFails(): Promise<void> {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });
  const fixture = makeFixture(Promise.reject(cause));
  const err = await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open }));
  assert(
    errorName(err) === "QueueConfigError",
    `expected QueueConfigError when the connect fails, got ${errorName(err)}`,
  );
  assert(
    errorMessage(err).includes("ECONNREFUSED"),
    `expected the message to carry the cause's code, got "${errorMessage(err)}"`,
  );
}

/** §9.6 — the cause's own message is never forwarded; a URL-derived string could carry a credential. */
export async function assertProbeDoesNotForwardTheCausesMessage(): Promise<void> {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });
  const fixture = makeFixture(Promise.reject(cause));
  const err = await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open }));
  assert(
    !errorMessage(err).includes("127.0.0.1:1"),
    `expected the cause's message text not to be forwarded, got "${errorMessage(err)}"`,
  );
  assert(fixture.closed === 1, `expected the connection closed once after a failed connect, got ${fixture.closed}`);
}

export async function assertProbeRejectsWhenPingDoesNotAnswerPong(): Promise<void> {
  const fixture = makeFixture(Promise.resolve({ ping: async () => "LOADING" }));
  const err = await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open }));
  assert(
    errorName(err) === "QueueConfigError",
    `expected QueueConfigError for a non-PONG reply, got ${errorName(err)}`,
  );
  assert(
    !errorMessage(err).includes("LOADING"),
    `expected the reply text not to be echoed, got "${errorMessage(err)}"`,
  );
}

export async function assertProbeRejectsWhenTheClientCannotPing(): Promise<void> {
  const fixture = makeFixture(Promise.resolve({}));
  const err = await captureRejection(() => probeRedis(CONNECTION, { open: fixture.open }));
  assert(
    errorName(err) === "QueueConfigError",
    `expected QueueConfigError when the client has no ping(), got ${errorName(err)}`,
  );
}

export function assertDefaultTimeoutIsFiveSeconds(): void {
  assert(
    REDIS_PROBE_TIMEOUT_MS === 5_000,
    `expected the default bound to be 5000 ms (the integration gate's REACHABILITY_TIMEOUT_MS), got ${REDIS_PROBE_TIMEOUT_MS}`,
  );
}
