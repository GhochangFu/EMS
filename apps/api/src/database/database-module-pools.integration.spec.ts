import type { Logger } from "@nestjs/common";
import pg from "pg";
import { expect, vi, type MockInstance } from "vitest";

/**
 * `F4.173` — the three `DatabaseModule` pools survive an idle client that the
 * server ends.
 *
 * `pg.Pool` emits `'error'` when the server ends a client that sits idle in the
 * pool — a Postgres restart, a failover, `pg_terminate_backend`, an idle-timeout
 * proxy. With no listener, Node throws from inside the socket callback and the
 * process exits. `DatabaseModule` is imported by both `app.module.ts` and
 * `worker.module.ts`, so before this row a Postgres restart took down REST,
 * auth, the websockets and the BullMQ worker together.
 *
 * **The gate is the logged line, not the absence of a crash.** With the
 * listener removed, vitest reports the throw as an "Unhandled Error" but the
 * `it()` that caused it can still pass. So each case asserts the line the
 * listener writes, and the recovery case asserts a query result.
 *
 * **Each case ends only its own backend.** The database is shared with the
 * running api container and with other sessions' suites, so the pid comes from
 * `pg_backend_pid()` on the pool under test and nothing is filtered by role or
 * `application_name`. The terminating client connects with the pool's own URL:
 * a role can end its own backends without `pg_signal_backend`.
 */

type ErrorSpy = MockInstance<Logger["error"]>;

/** Puts one client in the pool's idle list, then ends its backend server-side. */
export async function endIdleBackend(pool: pg.Pool, url: string): Promise<number> {
  const { rows } = await pool.query<{ pid: number }>("select pg_backend_pid()::int as pid");
  const pid = rows[0]?.pid;
  expect(pid).toBeTypeOf("number");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: ended } = await client.query<{ ended: boolean }>(
      "select pg_terminate_backend($1) as ended",
      [pid],
    );
    expect(ended[0]?.ended).toBe(true);
  } finally {
    await client.end();
  }
  return pid as number;
}

function loggedLines(spy: ErrorSpy): unknown[] {
  return spy.mock.calls.map((call) => call[0]);
}

async function waitForTerminateLine(name: string, spy: ErrorSpy): Promise<void> {
  await vi.waitFor(
    () =>
      expect(loggedLines(spy)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            new RegExp(`^${name} pool: .*terminating connection due to administrator command`),
          ),
        ]),
      ),
    { timeout: 5_000, interval: 50 },
  );
}

export async function assertIdleClientLossIsLoggedForPool(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  await endIdleBackend(pool, url);
  await waitForTerminateLine(name, spy);
}

export async function assertPoolServesTheNextQuery(
  name: string,
  pool: pg.Pool,
  url: string,
  spy: ErrorSpy,
): Promise<void> {
  const ended = await endIdleBackend(pool, url);
  // Synchronisation only: the idle client is out of the pool once the line is
  // logged, so the next query cannot be handed the dead one.
  await waitForTerminateLine(name, spy);

  const { rows } = await pool.query<{ one: number; pid: number }>(
    "select 1 as one, pg_backend_pid()::int as pid",
  );
  expect(rows[0]?.one).toBe(1);
  expect(rows[0]?.pid).not.toBe(ended);
}
