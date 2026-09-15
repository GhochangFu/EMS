import type { LivenessResponse, QueueHealth, StorageHealth } from "@bms/shared";
import { vi } from "vitest";

import { readRepoFile } from "../testing/repo-root";
import type { StorageClient } from "./storage-client";
import { readStorageHealth, withStorageVerdict } from "./storage-health";

/**
 * F3.3 (ADR 0066 decisions 3, 9; plan Q-A, Q-B) — the storage section of
 * `GET /health` and the second half of the liveness verdict.
 *
 * Assertions live here; `storage-health.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per claim, so a failure names the
 * claim it broke; the `queue-health.spec.ts` shape.
 *
 * `readStorageHealth` is pure over its `deps`: the bounded `HeadBucket` is
 * injected, so no spec here touches `@aws-sdk`. The three unreachable rows
 * are separate claims on purpose — a `"missing"` bucket, a rejection and a
 * read that never answers are three different failures that collapse to one
 * shape, and a reader that treated `"missing"` as reachable would pass the
 * other two.
 *
 * The configured-reachable row pins the **exact** shape including
 * `bucket: client.bucket`, so a reader that reported `bucket: null` while
 * configured fails here rather than in a browser.
 *
 * The last two rows are a source scan of `health/health.controller.ts`
 * (`F4.20`: esbuild emits no `design:paramtypes`, so no spec here boots a
 * Nest module). They hold the two properties the worker depends on — the
 * `@Optional()` on the injected service, and that the controller pulls in
 * neither `storage.module` nor `aws-s3-ops` nor the SDK, because
 * `health.controller.ts` is in the worker's import closure
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts`). No existing test makes
 * either claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BUCKET = "bms-asset-images";

const UNCONFIGURED_CLIENT: StorageClient = { kind: "unconfigured" };

function configuredClient(): StorageClient {
  return {
    kind: "configured",
    bucket: BUCKET,
    // `readStorageHealth` must never reach `ops` — the head read arrives
    // through `deps.headBucket` — and a fake that lacks it is what proves it.
    ops: undefined as never,
  };
}

const CONNECTED_QUEUE: QueueHealth = {
  configured: true,
  connected: true,
  queues: [],
  lastHeartbeatAt: new Date(Date.UTC(2026, 8, 15, 12, 0, 0)).toISOString(),
  heartbeatStale: false,
  lastRuleSweep: null,
};

const UNREADABLE_QUEUE: QueueHealth = {
  configured: true,
  connected: false,
  queues: [],
  lastHeartbeatAt: null,
  heartbeatStale: true,
  lastRuleSweep: null,
};

const REACHABLE: StorageHealth = { configured: true, reachable: true, bucket: BUCKET };
const UNREACHABLE: StorageHealth = { configured: true, reachable: false, bucket: BUCKET };
const UNCONFIGURED: StorageHealth = { configured: false, reachable: false, bucket: null };

function okBase(): LivenessResponse {
  return { status: "ok", queue: CONNECTED_QUEUE };
}

function degradedBase(): LivenessResponse {
  return { status: "degraded", queue: UNREADABLE_QUEUE };
}

function shape(health: StorageHealth): string {
  return JSON.stringify(health);
}

// ---------------------------------------------------------------------------
// readStorageHealth
// ---------------------------------------------------------------------------

export async function assertUnconfiguredShapeIsExact(): Promise<void> {
  const health = await readStorageHealth(UNCONFIGURED_CLIENT, {
    headBucket: () => Promise.reject(new Error("an unconfigured client must not head a bucket")),
  });
  assert(
    shape(health) === shape(UNCONFIGURED),
    `expected ${shape(UNCONFIGURED)} for an unconfigured client, got ${shape(health)}`,
  );
}

export async function assertConfiguredAndOkIsReachableWithItsBucket(): Promise<void> {
  const health = await readStorageHealth(configuredClient(), {
    headBucket: () => Promise.resolve("ok"),
  });
  assert(
    shape(health) === shape(REACHABLE),
    `expected ${shape(REACHABLE)} when headBucket answers "ok", got ${shape(health)}`,
  );
}

export async function assertMissingBucketIsUnreachable(): Promise<void> {
  const health = await readStorageHealth(configuredClient(), {
    headBucket: () => Promise.resolve("missing"),
  });
  assert(
    shape(health) === shape(UNREACHABLE),
    `expected ${shape(UNREACHABLE)} when headBucket answers "missing" — a bucket that is not there ` +
      `is not a reachable store — got ${shape(health)}`,
  );
}

export async function assertRejectingHeadBucketIsUnreachable(): Promise<void> {
  const health = await readStorageHealth(configuredClient(), {
    headBucket: () => Promise.reject(new Error("ECONNREFUSED")),
  });
  assert(
    shape(health) === shape(UNREACHABLE),
    `expected ${shape(UNREACHABLE)} when headBucket rejects, got ${shape(health)}`,
  );
}

export async function assertHangingHeadBucketIsUnreachableInsideTheTimeout(): Promise<void> {
  const started = Date.now();
  const health = await readStorageHealth(configuredClient(), {
    headBucket: () => new Promise<"ok">(() => {}),
    timeoutMs: 20,
  });
  const elapsed = Date.now() - started;
  assert(
    shape(health) === shape(UNREACHABLE),
    `expected ${shape(UNREACHABLE)} when headBucket never answers, got ${shape(health)}`,
  );
  assert(
    elapsed < 1_000,
    `expected the read to be bounded by timeoutMs: 20, and it took ${elapsed} ms`,
  );
}

export async function assertASettledReadLeavesNoPendingTimer(): Promise<void> {
  vi.useFakeTimers();
  try {
    await readStorageHealth(configuredClient(), { headBucket: () => Promise.resolve("ok") });
    const pending = vi.getTimerCount();
    assert(
      pending === 0,
      `expected the health timer to be cleared when the read settles, and ${pending} is still ` +
        "pending — a probe that runs every few seconds would hold one handle per read open",
    );
  } finally {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// withStorageVerdict (Q-B)
// ---------------------------------------------------------------------------

export function assertOkAndReachableStaysOk(): void {
  const body = withStorageVerdict(okBase(), REACHABLE);
  assert(
    body.status === "ok" && shape(body.storage as StorageHealth) === shape(REACHABLE),
    `expected status "ok" and the storage section carried through, got ${JSON.stringify(body)}`,
  );
}

export function assertConfiguredAndUnreachableDegrades(): void {
  const body = withStorageVerdict(okBase(), UNREACHABLE);
  assert(
    body.status === "degraded",
    `expected status "degraded" when a configured store is unreachable (Q-B), got ${JSON.stringify(body)}`,
  );
}

export function assertDegradedQueueStaysDegradedBesideReachableStorage(): void {
  const body = withStorageVerdict(degradedBase(), REACHABLE);
  assert(
    body.status === "degraded",
    `expected a degraded queue verdict to survive a reachable store, got ${JSON.stringify(body)}`,
  );
}

export function assertUnconfiguredStorageNeverDegrades(): void {
  const body = withStorageVerdict(okBase(), UNCONFIGURED);
  assert(
    body.status === "ok" && shape(body.storage as StorageHealth) === shape(UNCONFIGURED),
    `expected an unconfigured store to leave status "ok" — a chosen state, not a degradation — ` +
      `got ${JSON.stringify(body)}`,
  );
}

export function assertQueueSectionIsCarriedThroughUnchanged(): void {
  const base = okBase();
  const body = withStorageVerdict(base, REACHABLE);
  assert(
    JSON.stringify(body.queue) === JSON.stringify(CONNECTED_QUEUE),
    `expected the queue section to pass through untouched, got ${JSON.stringify(body.queue)}`,
  );
}

// ---------------------------------------------------------------------------
// The source scan of health/health.controller.ts
// ---------------------------------------------------------------------------

function healthControllerSource(): string {
  // `repoRoot()` walks up to the workspace manifest — `import.meta` is TS1343
  // under `apps/api`'s commonjs build, and a fixed depth is the F3.36 defect.
  return readRepoFile("apps/api/src/health/health.controller.ts");
}

export function assertTheControllerInjectsTheStorageReaderOptionally(): void {
  const source = healthControllerSource();
  const constructorText = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(source)?.[1] ?? "";
  const line =
    constructorText.split("\n").find((l) => l.includes("StorageHealthService")) ?? "";
  assert(
    line.includes("@Optional()"),
    `the StorageHealthService parameter of HealthController must carry @Optional() — the worker ` +
      `provides no StorageModule and would refuse to boot without it (Q-A) — got: ${line.trim() || constructorText}`,
  );
  // Positive control: the scan opened the real constructor.
  assert(
    constructorText.includes("QueueHealthService"),
    `the scan did not find HealthController's constructor (no QueueHealthService in it): ${constructorText}`,
  );
}

export function assertTheControllerPullsInNoStorageWiring(): void {
  const source = healthControllerSource();
  const forbidden = ["storage.module", "aws-s3-ops", "@aws-sdk"].filter((needle) =>
    source.includes(needle),
  );
  assert(
    forbidden.length === 0,
    `health.controller.ts is in the worker's import closure ` +
      `(tests/f4.24-worker-imports-no-api-loop.test.ts), so it must import none of ` +
      `storage.module, aws-s3-ops or @aws-sdk; it names: ${forbidden.join(", ")}`,
  );
  // Positive control: the scan opened a file that does reach the storage reader.
  assert(
    source.includes("storage-health.service"),
    "the scan did not open a health.controller.ts that imports StorageHealthService",
  );
}
