import type { Logger } from "@nestjs/common";
import pg from "pg";
import { expect, vi, type MockInstance } from "vitest";

/**
 * `F4.173` — the three `DatabaseModule` pools survive a client that the server
 * ends, whether the client is idle in the pool or checked out of it.
 *
 * pg emits `'error'` on a client whose backend the server ends — a Postgres
 * restart, a failover, `pg_terminate_backend`, an idle-timeout proxy. With no
 * listener, Node throws from inside the socket callback and the process exits.
 * pg-pool listens on an **idle** client and re-emits on the pool, so an idle
 * client needs a pool listener; it removes that listener when the client is
 * **checked out** (`pool.connect()`, which every drizzle `transaction()` and so
 * every `withTenant` uses), so a checked-out client needs its own.
 * `DatabaseModule` is imported by both `app.module.ts` and `worker.module.ts`,
 * so before this row a Postgres restart took down REST, auth, the websockets
 * and the BullMQ worker together.
 *
 * **The gate is the logged line, not the absence of a crash.** With the
 * listener removed, vitest reports the throw as an "Unhandled Error" but the
 * `it()` that caused it can still pass. So each case asserts the line the
 * listener writes, and the recovery cases assert a query result.
 *
 * **The line must be the only argument.** A second argument carrying the error
 * object would reach pino, which serializes the enumerable
 * `client.connectionParameters` (user, host, port). So a call only counts when
 * it has exactly one argument.
 *
 * **Each case ends only its own backend.** The database is shared with the
 * running api container and with other sessions' suites, so the pid comes from
 * `pg_backend_pid()` on the client under test and nothing is filtered by role
 * or `application_name`. The terminating client connects with the pool's own
 * URL: a role can end its own backends without `pg_signal_backend`.
 *
 * **A red run prints the role passwords.** When a listener is missing, vitest
 * serializes the uncaught error with its `client`, and its serializer walks
 * non-enumerable properties, so `connectionParameters.password` appears in the
 * output. In CI these are the dev defaults already in the workflow file; do
 * not share a red local run made with real credentials.
 */

type ErrorSpy = MockInstance<Logger["error"]>;
type ClientState = "idle" | "checked-out";

async function terminateBackend(url: string, pid: number): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ ended: boolean }>(
      "select pg_terminate_backend($1) as ended",
      [pid],
    );
    expect(rows[0]?.ended).toBe(true);
  } finally {
    await client.end();
  }
}

async function backendPid(queryable: pg.Pool | pg.PoolClient): Promise<number> {
  const { rows } = await queryable.query<{ pid: number }>("select pg_backend_pid()::int as pid");
  const pid = rows[0]?.pid;
  expect(pid).toBeTypeOf("number");
  return pid as number;
}

/** Puts one client in the pool's idle list, then ends its backend server-side. */
export async function endIdleBackend(pool: pg.Pool, url: string): Promise<number> {
  const pid = await backendPid(pool);
  await terminateBackend(url, pid);
  return pid;
}

/** Waits for one single-argument line naming the pool, the client state and the 57P01 reason. */
async function waitForTerminateLine(name: string, state: ClientState, spy: ErrorSpy): Promise<void> {
  await vi.waitFor(
    () =>
      expect(spy.mock.calls).toEqual(
        expect.arrayContaining([
          [
            expect.stringMatching(
              new RegExp(
                `^${name} pool: ${state} client error: terminating connection due to administrator command$`,
              ),
            ),
          ],
        ]),
      ),
    { timeout: 5_000, interval: 50 },
  );
}

/**
 * Checks a client out, ends its backend while it is held, waits for the line,
 * then releases it. Returns the ended pid.
 */
async function endCheckedOutBackend(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<number> {
  const client = await pool.connect();
  try {
    const pid = await backendPid(client);
    await terminateBackend(url, pid);
    await waitForTerminateLine(name, "checked-out", spy);
    return pid;
  } finally {
    client.release();
  }
}

/** An idle client ended server-side is logged once, with the pool name and the reason. */
export async function assertIdleClientLossIsLoggedForPool(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  await endIdleBackend(pool, url);
  await waitForTerminateLine(name, "idle", spy);
}

/** After an idle client is ended, the pool answers the next query on a new backend. */
export async function assertPoolServesTheNextQuery(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  const ended = await endIdleBackend(pool, url);
  // Synchronisation only: the idle client is out of the pool once the line is
  // logged, so the next query cannot be handed the dead one.
  await waitForTerminateLine(name, "idle", spy);

  const { rows } = await pool.query<{ one: number; pid: number }>(
    "select 1 as one, pg_backend_pid()::int as pid",
  );
  expect(rows[0]?.one).toBe(1);
  expect(rows[0]?.pid).not.toBe(ended);
}

/** A checked-out client ended server-side is logged, with the pool name and the reason. */
export async function assertCheckedOutClientLossIsLoggedForPool(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  await endCheckedOutBackend(name, pool, url, spy);
}

/** After a checked-out client is ended and released, the pool answers on a new backend. */
export async function assertPoolServesTheNextQueryAfterACheckout(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  const ended = await endCheckedOutBackend(name, pool, url, spy);

  const { rows } = await pool.query<{ one: number; pid: number }>(
    "select 1 as one, pg_backend_pid()::int as pid",
  );
  expect(rows[0]?.one).toBe(1);
  expect(rows[0]?.pid).not.toBe(ended);
}

/**
 * A checkout leaves no listener behind: the client's `'error'` listener count
 * after a second checkout and release equals the count after the first.
 */
export async function assertCheckoutLeavesNoListenerBehind(pool: pg.Pool): Promise<void> {
  const first = await pool.connect();
  first.release();
  const settled = first.listenerCount("error");

  const second = await pool.connect();
  second.release();
  // pg-pool hands back the most recently released idle client; the count
  // only means something if it is the same one.
  expect(second).toBe(first);
  expect(second.listenerCount("error")).toBe(settled);
}
