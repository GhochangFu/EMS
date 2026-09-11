import { createServer, type AddressInfo } from "node:net";

import { probeWorkerPortFree } from "./worker-port-probe";

/**
 * F4.24 (ADR 0063 decision 9) — the worker's port pre-flight, added by the
 * 2026-09-11 review (Blocker A). Nest runs `onModuleInit` inside `listen()`
 * *before* the port is bound, so a `WORKER_PORT` already in use used to be
 * discovered after the heartbeat scheduler had been upserted into Redis.
 * Measured with `WORKER_PORT=6379`: `EADDRINUSE` on stderr and eight
 * `bms:heartbeat:*` keys written by a process that then exited.
 *
 * Assertions live here; `worker-port-probe.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). Two rows drive a fake `listen`; two bind a real
 * ephemeral port so the default `listen` is exercised, not only its
 * injection seam. Errors are matched on `err.name`, never `instanceof`
 * (F4.108).
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
// Fake-driven rows
// ---------------------------------------------------------------------------

export async function assertBoundPortRejectsNamingThePortAndTheCode(): Promise<void> {
  const err = await captureRejection(() =>
    probeWorkerPortFree(6379, {
      listen: async () => {
        throw Object.assign(new Error("listen EADDRINUSE: address already in use :::6379"), {
          code: "EADDRINUSE",
        });
      },
    }),
  );
  assert(
    errorName(err) === "QueueConfigError",
    `expected QueueConfigError for a bound port, got ${errorName(err)}`,
  );
  assert(
    errorMessage(err).includes("WORKER_PORT 6379") && errorMessage(err).includes("EADDRINUSE"),
    `expected the message to name WORKER_PORT 6379 and EADDRINUSE, got "${errorMessage(err)}"`,
  );
}

export async function assertFreePortIsReleasedOnce(): Promise<void> {
  let released = 0;
  await probeWorkerPortFree(4100, {
    listen: async () => async () => {
      released += 1;
    },
  });
  assert(
    released === 1,
    `expected the pre-flight listener released exactly once, got ${released} — a held port would make Nest's own listen fail`,
  );
}

// ---------------------------------------------------------------------------
// Real-port rows (the default `listen`)
// ---------------------------------------------------------------------------

/** Port 0 asks the OS for an ephemeral port, which is free by definition. */
export async function assertDefaultListenResolvesOnAFreePort(): Promise<void> {
  await probeWorkerPortFree(0);
}

export async function assertDefaultListenRejectsOnAPortAnotherServerHolds(): Promise<void> {
  const holder = createServer();
  await new Promise<void>((resolve) => {
    holder.listen(0, () => resolve());
  });
  const port = (holder.address() as AddressInfo).port;
  try {
    const err = await captureRejection(() => probeWorkerPortFree(port));
    assert(
      errorName(err) === "QueueConfigError" && errorMessage(err).includes(`WORKER_PORT ${port}`),
      `expected QueueConfigError naming WORKER_PORT ${port} for a port another server holds, got ${errorName(err)}: "${errorMessage(err)}"`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      holder.close(() => resolve());
    });
  }
}
