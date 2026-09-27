import type pg from "pg";
import { vi } from "vitest";

import { FIXTURE_REFRESH_RETRY, materializeCompleteBuckets, retryOnConcurrentRefresh } from "./cagg-materialize";

/**
 * `F4.149` — the pure/near-pure half of the `55P03` retry pinned onto the
 * integration fixture helper. Assertions live here (§4.6/ADR 0014); the
 * sibling `.test.ts` only runs them.
 *
 * A fake `pg.Pool` whose `connect()` returns a fake client with a scripted
 * `query` — no database, `delayMs: 0` throughout so the suite runs at once.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function concurrentRefreshError(): Error & { code: string } {
  return Object.assign(new Error("could not refresh continuous aggregate due to a concurrent refresh"), {
    code: "55P03",
  });
}

function otherError(code: string): Error & { code: string } {
  return Object.assign(new Error(`unrelated failure ${code}`), { code });
}

interface FakeClient {
  query: (...args: unknown[]) => Promise<unknown>;
  release: (err?: unknown) => void;
  calls: unknown[][];
  released: number;
  releasedWith: unknown[];
}

function makeFakeClient(queryImpl: (...args: unknown[]) => Promise<unknown>): FakeClient {
  const calls: unknown[][] = [];
  const releasedWith: unknown[] = [];
  const client: FakeClient = {
    calls,
    released: 0,
    releasedWith,
    query: async (...args: unknown[]) => {
      calls.push(args);
      return queryImpl(...args);
    },
    release: (err?: unknown) => {
      client.released += 1;
      releasedWith.push(err);
    },
  };
  return client;
}

function fakePool(client: FakeClient): pg.Pool {
  return {
    connect: async () => client as unknown as pg.PoolClient,
  } as unknown as pg.Pool;
}

function callStatements(client: FakeClient): string[] {
  return client.calls
    .map((args) => args[0])
    .filter((sql): sql is string => typeof sql === "string" && sql.startsWith("CALL"));
}

/**
 * 1. `raises55P03OnceThenTheSecondCallSucceeds` — the spec the row asks for.
 * The first `CALL` for the `1m` level rejects with `55P03`; the retried call
 * and the remaining three levels each resolve once.
 */
export async function raises55P03OnceThenTheSecondCallSucceeds(): Promise<void> {
  let callCount = 0;
  const client = makeFakeClient(async (sql: unknown) => {
    if (typeof sql === "string" && sql.startsWith("CALL")) {
      callCount += 1;
      if (callCount === 1) {
        throw concurrentRefreshError();
      }
    }
    return { rows: [] };
  });

  await materializeCompleteBuckets(fakePool(client), 0, 4 * 86_400_000, 5 * 86_400_000, { attempts: 5, delayMs: 0 });

  const statements = callStatements(client);
  assert(
    statements.length === 5,
    `expected 5 CALL statements (1m retried once + 4 levels), got ${statements.length}`,
  );
}

/** 2. `aNon55P03ErrorIsRethrownAtOnce` — a different SQLSTATE never retries. */
export async function aNon55P03ErrorIsRethrownAtOnce(): Promise<void> {
  const client = makeFakeClient(async (sql: unknown) => {
    if (typeof sql === "string" && sql.startsWith("CALL")) {
      throw otherError("42501");
    }
    return { rows: [] };
  });

  let thrown: unknown;
  try {
    await materializeCompleteBuckets(fakePool(client), 0, 4 * 86_400_000, 5 * 86_400_000, { attempts: 5, delayMs: 0 });
  } catch (err) {
    thrown = err;
  }

  assert(thrown instanceof Error, "a non-55P03 error must propagate");
  assert((thrown as { code?: string }).code === "42501", "the original error must propagate unaltered");
  assert(callStatements(client).length === 1, `expected exactly 1 CALL statement, got ${callStatements(client).length}`);
}

/** 3. `theBudgetIsExhaustedAndTheLastErrorIsThrown` — always 55P03, attempts: 2. */
export async function theBudgetIsExhaustedAndTheLastErrorIsThrown(): Promise<void> {
  const client = makeFakeClient(async (sql: unknown) => {
    if (typeof sql === "string" && sql.startsWith("CALL")) {
      throw concurrentRefreshError();
    }
    return { rows: [] };
  });

  let thrown: unknown;
  try {
    await materializeCompleteBuckets(fakePool(client), 0, 4 * 86_400_000, 5 * 86_400_000, { attempts: 2, delayMs: 0 });
  } catch (err) {
    thrown = err;
  }

  assert(thrown instanceof Error, "the budget's last error must throw");
  assert((thrown as { code?: string }).code === "55P03", "the thrown error must be the 55P03 conflict");
  assert(callStatements(client).length === 2, `expected exactly 2 CALL statements (the attempts budget), got ${callStatements(client).length}`);
}

/** 4. `resetRoleRunsAfterAThrow` — RESET ROLE runs and release() is called once, even on a throw. */
export async function resetRoleRunsAfterAThrow(): Promise<void> {
  const client = makeFakeClient(async (sql: unknown) => {
    if (typeof sql === "string" && sql.startsWith("CALL")) {
      throw concurrentRefreshError();
    }
    return { rows: [] };
  });

  try {
    await materializeCompleteBuckets(fakePool(client), 0, 4 * 86_400_000, 5 * 86_400_000, { attempts: 1, delayMs: 0 });
  } catch {
    // expected
  }

  const resetRoleCalls = client.calls.filter((args) => args[0] === "RESET ROLE");
  assert(resetRoleCalls.length === 1, `expected RESET ROLE to run exactly once, got ${resetRoleCalls.length}`);
  assert(client.released === 1, `expected release() to be called exactly once, got ${client.released}`);
}

/**
 * 5. `theDefaultBudgetIsFiveAttemptsThreeSeconds` — the exported default cannot
 * silently lose its value (the "optional parameter at an adapter" trap).
 */
export function theDefaultBudgetIsFiveAttemptsThreeSeconds(): void {
  assert(FIXTURE_REFRESH_RETRY.attempts === 5, `expected attempts === 5, got ${FIXTURE_REFRESH_RETRY.attempts}`);
  assert(FIXTURE_REFRESH_RETRY.delayMs === 3_000, `expected delayMs === 3000, got ${FIXTURE_REFRESH_RETRY.delayMs}`);
}

// Exercises `retryOnConcurrentRefresh` directly as well, since
// `materializeCompleteBuckets` only proves it through the wrapper.
export async function retryOnConcurrentRefreshRetriesOnlyThatCode(): Promise<void> {
  let calls = 0;
  const result = await retryOnConcurrentRefresh(async () => {
    calls += 1;
    if (calls === 1) {
      throw concurrentRefreshError();
    }
    return "ok";
  }, { attempts: 3, delayMs: 0 });

  assert(result === "ok", "retryOnConcurrentRefresh must return the work's resolved value");
  assert(calls === 2, `expected work to run twice, got ${calls}`);
}

/**
 * Settles `promise` into a value, so a rejection is observed as data rather
 * than as an unhandled rejection while fake timers hold it pending.
 */
function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * 7. `retryOnConcurrentRefreshUsesTheDefaultBudget` — every case above passes
 * `retry` explicitly, so the DEFAULT parameter itself was ungated: changing
 * `retry = FIXTURE_REFRESH_RETRY` to `{ attempts: 1, delayMs: 0 }` stayed
 * green. This call omits `retry`, throws `55P03` once, and proves the retry
 * waits the default 3000 ms — not sooner, and not never.
 */
export async function retryOnConcurrentRefreshUsesTheDefaultBudget(): Promise<void> {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const settled = settle(
      retryOnConcurrentRefresh(async () => {
        calls += 1;
        if (calls === 1) {
          throw concurrentRefreshError();
        }
        return "ok";
      }),
    );

    await vi.advanceTimersByTimeAsync(2_999);
    assert(calls === 1, `expected no retry before the default 3000 ms delay, got ${calls} calls at 2999 ms`);
    await vi.advanceTimersByTimeAsync(1);
    assert(calls === 2, `expected the default budget to retry once at 3000 ms, got ${calls} calls`);

    const outcome = await settled;
    assert(outcome.ok, "the retried call must resolve under the default budget");
  } finally {
    vi.useRealTimers();
  }
}

/**
 * 8. `materializeCompleteBucketsUsesTheDefaultBudget` — the same gate for the
 * wrapper's own default, which it passes down to `retryOnConcurrentRefresh`
 * explicitly, so the case above cannot reach it.
 */
export async function materializeCompleteBucketsUsesTheDefaultBudget(): Promise<void> {
  vi.useFakeTimers();
  try {
    let callCount = 0;
    const client = makeFakeClient(async (sql: unknown) => {
      if (typeof sql === "string" && sql.startsWith("CALL")) {
        callCount += 1;
        if (callCount === 1) {
          throw concurrentRefreshError();
        }
      }
      return { rows: [] };
    });

    const settled = settle(materializeCompleteBuckets(fakePool(client), 0, 4 * 86_400_000, 5 * 86_400_000));

    await vi.advanceTimersByTimeAsync(2_999);
    assert(
      callStatements(client).length === 1,
      `expected no retry before the default 3000 ms delay, got ${callStatements(client).length} CALLs at 2999 ms`,
    );
    await vi.advanceTimersByTimeAsync(1);
    assert(
      callStatements(client).length >= 2,
      `expected the default budget to retry the 1m CALL at 3000 ms, got ${callStatements(client).length} CALLs`,
    );

    const outcome = await settled;
    assert(outcome.ok, "materializeCompleteBuckets must resolve under the default budget");
    assert(
      callStatements(client).length === 5,
      `expected 5 CALL statements (1m retried once + 4 levels), got ${callStatements(client).length}`,
    );
  } finally {
    vi.useRealTimers();
  }
}
