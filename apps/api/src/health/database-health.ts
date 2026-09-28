import type { DatabaseHealth, LivenessResponse, ReadinessResponse } from "@bms/shared";

/**
 * The `database` section of `GET /health`, the database half of its verdict,
 * and the body of `GET /health/ready` (`F4.175`, ADR 0063 Amendment 3).
 *
 * **Why this exists.** Before `F4.173` a Postgres outage crashed both
 * processes, so the outage was visible as a dead process. `F4.173` put
 * `'error'` listeners on every pool and client, so the processes now stay up
 * through an outage — and `GET /health`, which probed only Redis and the
 * object store, answered `ok` the whole time.
 *
 * `readDatabaseHealth` is pure over its `deps`: the `select 1` is injected, so
 * the spec runs it against fakes and `DatabaseHealthService` hands it the
 * fleet pool's query. **The timeout is mandatory, not defensive**, for the
 * reason `queue-health.ts` gives about Redis: a server that accepts the TCP
 * connection and then answers nothing would hang the probe. Every read races
 * the ping against `timeoutMs` (2 s by default), and a loss on either side
 * collapses to `{ reachable: false }`. The timer is cleared on both branches.
 *
 * **The error is dropped, never surfaced.** A pg error names the host, the
 * port, the role and sometimes the reason a password failed; none of it
 * belongs in an unauthenticated probe body.
 */

export const DATABASE_HEALTH_TIMEOUT_MS: number = 2_000;

export type DatabaseHealthDeps = {
  /** Resolves when the database answered `select 1`; anything else rejects. */
  ping(): Promise<void>;
  /** Defaults to `DATABASE_HEALTH_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * Rejects after `ms`. The caller clears it on the other branch — the
 * `storage-health.ts` helper, copied rather than shared for the reason that
 * file gives: two probes, two budgets.
 */
function timeoutAfter(ms: number): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`database health read exceeded ${ms} ms`));
    }, ms);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/** Reads the `database` section — one bounded `select 1`. */
export async function readDatabaseHealth(deps: DatabaseHealthDeps): Promise<DatabaseHealth> {
  const timeout = timeoutAfter(deps.timeoutMs ?? DATABASE_HEALTH_TIMEOUT_MS);
  try {
    await Promise.race([deps.ping(), timeout.promise]);
    return { reachable: true };
  } catch {
    // A refused connection, a failed login, a query error or the timer: one shape.
    return { reachable: false };
  } finally {
    timeout.clear();
  }
}

/** The third place the liveness verdict is decided; it only ever tightens `ok` to `degraded`. HTTP 200 either way. */
export function withDatabaseVerdict(
  base: LivenessResponse,
  database: DatabaseHealth,
): LivenessResponse {
  const degraded = base.status === "degraded" || !database.reachable;
  return { ...base, database, status: degraded ? "degraded" : "ok" };
}

/** The readiness body: the database alone decides it. */
export function readinessFrom(database: DatabaseHealth): ReadinessResponse {
  return { status: database.reachable ? "ready" : "not_ready", database };
}
