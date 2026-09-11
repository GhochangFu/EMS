import { createServer } from "node:net";

import { QueueConfigError } from "./queue-config";

/**
 * The worker's port pre-flight (ADR 0063 decision 9 — the worker refuses to
 * start rather than half-start).
 *
 * Added by the 2026-09-11 review (Blocker A). Nest binds the port at the end
 * of `app.listen()`, *after* it has run every `onModuleInit` — so with
 * `WORKER_PORT` already in use, `WorkerHostService.onModuleInit` had upserted
 * the heartbeat scheduler and started the BullMQ `Worker` before
 * `EADDRINUSE` arrived. Measured with `WORKER_PORT=6379`: the stderr line,
 * exit 1, and eight `bms:heartbeat:*` keys written by a process that never
 * served `/health`. Binding and releasing the port first moves that refusal
 * ahead of the Nest context, so the failed boot touches nothing in Redis.
 *
 * A bind-then-release is a pre-flight, not a lock: another process could
 * take the port in the gap before Nest's own `listen`, and that case still
 * ends in the entrypoint's catch. The port number is not a secret and the
 * message carries it.
 *
 * `listen` is injectable only so the spec can drive the refusal without a
 * real collision; two spec rows bind a real ephemeral port to exercise the
 * default.
 */

export type WorkerPortProbeDeps = {
  /** Binds `port` and resolves with the release; rejects with Node's `EADDRINUSE` error when it cannot. */
  listen(port: number): Promise<() => Promise<void>>;
};

/** `server.listen(port)` with no host — the same dual-stack bind Nest's `listen(port)` performs. */
function listenOnce(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve(
        () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      );
    });
  });
}

/** Resolves when `port` can be bound (and releases it at once); throws `QueueConfigError` naming the port otherwise. */
export async function probeWorkerPortFree(
  port: number,
  deps: WorkerPortProbeDeps = { listen: listenOnce },
): Promise<void> {
  let release: () => Promise<void>;
  try {
    release = await deps.listen(port);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    throw new QueueConfigError(
      `WORKER_PORT ${port} cannot be bound${typeof code === "string" ? ` (${code})` : ""}`,
    );
  }
  await release();
}
