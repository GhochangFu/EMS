import type { LivenessResponse, StorageHealth } from "@bms/shared";

import type { StorageClient } from "./storage-client";

/**
 * The storage section of `GET /health`, and the second half of the verdict
 * drawn from it (ADR 0066 decisions 3, 9; plan Q-A, Q-B).
 *
 * `readStorageHealth` is pure over its `deps`: the bounded `HeadBucket` is
 * injected, so the spec runs it against four fake readers and Unit 5's
 * `StorageHealthService` hands it the client's own `ops.headBucket`. It
 * never constructs an SDK client itself, and it never reaches
 * `client.ops` — that is the service's job.
 *
 * **The timeout is mandatory, not defensive**, for the reason
 * `queue-health.ts` gives about Redis: an S3 endpoint that accepts the TCP
 * connection and then answers nothing would hang the probe, and a liveness
 * probe that hangs is worse than one that answers `degraded`. Every read
 * races `headBucket()` against `timeoutMs` (1.5 s by default), and a loss
 * on either side — a rejection, a `"missing"` bucket or the timer —
 * collapses to the one `reachable: false` shape. The timer is cleared on
 * both branches, so a probe that runs every few seconds leaves no pending
 * handle behind and nothing keeps the process alive.
 *
 * **`"missing"` is unreachable, not a separate state.** The contract has
 * two booleans (`packages/shared/src/contracts/health.ts`): a store whose
 * bucket is not there cannot serve an object, and decision 9 already makes
 * the bucket the API's to create at init. The reason is not surfaced in
 * the body — a probe body is not a place for an error message.
 *
 * `withStorageVerdict` is the **second** place the verdict is decided, and
 * it only ever tightens `livenessFrom`'s: an unconfigured store is `ok` (a
 * chosen state, ADR 0002's native-dev path, mirroring the unconfigured
 * queue) and a configured, unreachable one is `degraded` — HTTP 200 either
 * way (Q-B). It is applied by `HealthController` only when a
 * `StorageHealthService` is injected, so the worker's body carries no
 * `storage` key at all (Q-A).
 */

export const STORAGE_HEALTH_TIMEOUT_MS: number = 1_500;

export type StorageHealthDeps = {
  /** `"ok"` when the bound bucket is there, `"missing"` when it is not; anything else throws. */
  headBucket(): Promise<"ok" | "missing">;
  /** Defaults to `STORAGE_HEALTH_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * Rejects after `ms`. The timer is cleared by the caller on the other
 * branch so a successful read leaves no pending handle behind — the
 * `queue-health.ts` helper, copied rather than shared: two probes, two
 * budgets, and neither file owns the other's timer.
 */
function timeoutAfter(ms: number): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`storage health read exceeded ${ms} ms`));
    }, ms);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/** Reads the `storage` section of `GET /health` — configured, reachable, and the bound bucket — bounded by `timeoutMs`. */
export async function readStorageHealth(
  client: StorageClient,
  deps: StorageHealthDeps,
): Promise<StorageHealth> {
  if (client.kind === "unconfigured") {
    return { configured: false, reachable: false, bucket: null };
  }

  const timeout = timeoutAfter(deps.timeoutMs ?? STORAGE_HEALTH_TIMEOUT_MS);
  let head: "ok" | "missing";
  try {
    head = await Promise.race([deps.headBucket(), timeout.promise]);
  } catch {
    // A transport failure, a refused credential or the timer: one shape.
    return { configured: true, reachable: false, bucket: client.bucket };
  } finally {
    timeout.clear();
  }

  return { configured: true, reachable: head === "ok", bucket: client.bucket };
}

/** The second place the verdict is decided: `degraded` when a configured store is unreachable, otherwise `livenessFrom`'s verdict stands (Q-B). */
export function withStorageVerdict(
  base: LivenessResponse,
  storage: StorageHealth,
): LivenessResponse {
  const degraded = base.status === "degraded" || (storage.configured && !storage.reachable);
  return { ...base, storage, status: degraded ? "degraded" : "ok" };
}
