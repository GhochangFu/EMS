import { vi } from "vitest";

import type { S3Ops, StorageClient } from "./storage-client";
import { STORAGE_BOOTSTRAP_TIMEOUT_MS, StorageBootstrap } from "./storage.module";

/**
 * `F3.3` (ADR 0066 decision 9; review finding C, 2026-09-15) —
 * `StorageBootstrap.onModuleInit` is **bounded**. Assertions live here;
 * `storage.bootstrap.test.ts` is the Vitest entry point (§4.6/ADR 0014).
 *
 * Before this spec the boot awaited `ensureBucket` with no timer: an endpoint
 * that accepts the TCP connection and never answers (a firewall that
 * blackholes, a MinIO stuck in startup) held the API in `onModuleInit`
 * forever, with no log line, and the container never became healthy or
 * unhealthy. The bound turns that into a refused boot whose message names
 * the timeout — and never the endpoint (§9.6).
 *
 * Fake timers, not a shortened budget: `STORAGE_BOOTSTRAP_TIMEOUT_MS` is a
 * constant the class reads directly, so an injectable override would be an
 * optional parameter no production caller sets — invisible at the adapter.
 * `vi.advanceTimersByTimeAsync` walks the real constant instead.
 */

const ENDPOINT_HOST = "minio.example.test";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

/** A configured client whose `headBucket` is what the scenario says; every other op is unreachable at boot. */
function clientWith(headBucket: S3Ops["headBucket"]): StorageClient {
  const unreachable = (name: string) => async () => {
    throw new Error(`${name} must not be called by the bootstrap when headBucket answers ok`);
  };
  return {
    kind: "configured",
    bucket: "bms-asset-images",
    ops: {
      headBucket,
      createBucket: unreachable("createBucket"),
      putObject: unreachable("putObject"),
      getObject: unreachable("getObject") as S3Ops["getObject"],
      headObject: unreachable("headObject") as S3Ops["headObject"],
      deleteObject: unreachable("deleteObject"),
    },
  };
}

/** A `headBucket` that never settles — the silent endpoint. Its rejection carries the host, so a leak would show. */
function neverSettling(): S3Ops["headBucket"] {
  return () =>
    new Promise<"ok" | "missing">(() => {
      // deliberately never resolved or rejected
      void ENDPOINT_HOST;
    });
}

type TimedOutRun = { readonly err: unknown; readonly settledBeforeTimeout: boolean };

async function runAgainstASilentEndpoint(): Promise<TimedOutRun> {
  vi.useFakeTimers();
  try {
    const bootstrap = new StorageBootstrap(clientWith(neverSettling()));
    let settled = false;
    let err: unknown;
    const init = bootstrap.onModuleInit().then(
      () => {
        settled = true;
      },
      (e: unknown) => {
        settled = true;
        err = e;
      },
    );
    await vi.advanceTimersByTimeAsync(STORAGE_BOOTSTRAP_TIMEOUT_MS - 1);
    const settledBeforeTimeout = settled;
    await vi.advanceTimersByTimeAsync(1);
    await init;
    return { err, settledBeforeTimeout };
  } finally {
    vi.useRealTimers();
  }
}

export function assertBootstrapTimeoutIsTenSeconds(): void {
  assert(STORAGE_BOOTSTRAP_TIMEOUT_MS === 10_000, `expected 10000 ms, got ${STORAGE_BOOTSTRAP_TIMEOUT_MS}`);
}

export async function assertASilentEndpointRefusesTheBoot(): Promise<void> {
  const run = await runAgainstASilentEndpoint();
  assert(run.err !== undefined, "onModuleInit must reject when ensureBucket never settles");
}

/** The bound is the constant, not something shorter: one tick before it, nothing has settled. */
export async function assertTheBootIsNotRefusedBeforeTheTimeout(): Promise<void> {
  const run = await runAgainstASilentEndpoint();
  assert(!run.settledBeforeTimeout, "onModuleInit settled before STORAGE_BOOTSTRAP_TIMEOUT_MS elapsed");
}

export async function assertTheRefusalNamesTheTimeoutAndNotTheEndpoint(): Promise<void> {
  const run = await runAgainstASilentEndpoint();
  const message = errorMessage(run.err);
  assert(message.includes(String(STORAGE_BOOTSTRAP_TIMEOUT_MS)), `the refusal must name the timeout: ${message}`);
  assert(!message.includes(ENDPOINT_HOST), `the refusal must not name the endpoint (§9.6): ${message}`);
}

/** The positive control: a store that answers boots, and leaves no pending timer behind. */
export async function assertAnAnsweringEndpointBootsAndClearsTheTimer(): Promise<void> {
  vi.useFakeTimers();
  try {
    const bootstrap = new StorageBootstrap(clientWith(async () => "ok"));
    await bootstrap.onModuleInit();
    const pending = vi.getTimerCount();
    assert(pending === 0, `expected the bootstrap timer to be cleared on success, ${pending} still pending`);
  } finally {
    vi.useRealTimers();
  }
}

/** An unconfigured client returns at once — no timer, no S3 call. */
export async function assertAnUnconfiguredClientBootsWithoutATimer(): Promise<void> {
  vi.useFakeTimers();
  try {
    await new StorageBootstrap({ kind: "unconfigured" }).onModuleInit();
    assert(vi.getTimerCount() === 0, "an unconfigured client must arm no timer");
  } finally {
    vi.useRealTimers();
  }
}
