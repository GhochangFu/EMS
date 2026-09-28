import type {
  DatabaseHealth,
  LivenessResponse,
  QueueHealth,
  ReadinessResponse,
} from "@bms/shared";
import { vi } from "vitest";

import { readRepoFile } from "../testing/repo-root";
import { readDatabaseHealth, readinessFrom, withDatabaseVerdict } from "./database-health";
import { HealthController } from "./health.controller";

/**
 * `F4.175` (ADR 0063 Amendment 3) — the `database` section of `GET /health`,
 * the database half of the liveness verdict, and `GET /health/ready`.
 *
 * Assertions live here; `database-health.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per claim; the
 * `storage-health.spec.ts` shape.
 *
 * `readDatabaseHealth` is pure over its `deps`: the bounded `select 1` is
 * injected, so no row here needs Postgres. The two unreachable rows are
 * separate claims — a rejection and a query that never answers are two
 * failures that collapse to one shape, and a reader that bounded only one of
 * them would pass the other.
 *
 * The controller rows build `HealthController` by hand (`F4.20`: esbuild emits
 * no `design:paramtypes`, so no spec here boots a Nest module) over fake
 * readers and a fake `Response`, and read the status code the route set. The
 * same rows against a real pool are in `database-health.integration.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REACHABLE: DatabaseHealth = { reachable: true };
const UNREACHABLE: DatabaseHealth = { reachable: false };

const UNCONFIGURED_QUEUE: QueueHealth = {
  configured: false,
  connected: false,
  queues: [],
  lastHeartbeatAt: null,
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

function okBase(): LivenessResponse {
  return { status: "ok", queue: UNCONFIGURED_QUEUE };
}

function degradedBase(): LivenessResponse {
  return { status: "degraded", queue: UNREADABLE_QUEUE };
}

function shape(value: unknown): string {
  return JSON.stringify(value);
}

type FakeResponse = { statusCode: number | null; status(code: number): FakeResponse };

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function controllerOver(database: DatabaseHealth): HealthController {
  return new HealthController(
    { read: () => Promise.resolve(okBase()) } as never,
    { read: () => Promise.resolve(database) } as never,
  );
}

// ---------------------------------------------------------------------------
// readDatabaseHealth
// ---------------------------------------------------------------------------

export async function assertAnsweringPingIsReachable(): Promise<void> {
  const health = await readDatabaseHealth({ ping: () => Promise.resolve() });
  assert(
    shape(health) === shape(REACHABLE),
    `expected ${shape(REACHABLE)} when the ping answers, got ${shape(health)}`,
  );
}

export async function assertRejectingPingIsUnreachable(): Promise<void> {
  const health = await readDatabaseHealth({
    ping: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
  });
  assert(
    shape(health) === shape(UNREACHABLE),
    `expected ${shape(UNREACHABLE)} when the ping rejects, got ${shape(health)}`,
  );
}

export async function assertHangingPingIsUnreachableInsideTheTimeout(): Promise<void> {
  const started = Date.now();
  const health = await readDatabaseHealth({
    ping: () => new Promise<void>(() => {}),
    timeoutMs: 20,
  });
  const elapsed = Date.now() - started;
  assert(
    shape(health) === shape(UNREACHABLE),
    `expected ${shape(UNREACHABLE)} when the ping never answers, got ${shape(health)}`,
  );
  assert(
    elapsed < 1_000,
    `expected the read to be bounded by timeoutMs: 20, and it took ${elapsed} ms`,
  );
}

export async function assertASettledReadLeavesNoPendingTimer(): Promise<void> {
  vi.useFakeTimers();
  try {
    await readDatabaseHealth({ ping: () => Promise.resolve() });
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

export async function assertTheErrorTextNeverReachesTheBody(): Promise<void> {
  const health = await readDatabaseHealth({
    ping: () => Promise.reject(new Error("password authentication failed for user bms_fleet")),
  });
  const body = shape(health);
  assert(
    !/password|bms_fleet|authentication/.test(body),
    `expected no connection detail in the database section, got ${body}`,
  );
}

// ---------------------------------------------------------------------------
// withDatabaseVerdict
// ---------------------------------------------------------------------------

export function assertOkAndReachableStaysOk(): void {
  const body = withDatabaseVerdict(okBase(), REACHABLE);
  assert(body.status === "ok", `expected ok beside a reachable database, got ${body.status}`);
}

export function assertUnreachableDatabaseDegrades(): void {
  const body = withDatabaseVerdict(okBase(), UNREACHABLE);
  assert(
    body.status === "degraded",
    `expected degraded beside an unreachable database, got ${body.status}`,
  );
}

export function assertDegradedStaysDegradedBesideReachableDatabase(): void {
  const body = withDatabaseVerdict(degradedBase(), REACHABLE);
  assert(
    body.status === "degraded",
    `expected a degraded queue verdict to survive a reachable database, got ${body.status}`,
  );
}

export function assertTheSectionIsCarriedIntoTheBody(): void {
  const body = withDatabaseVerdict(okBase(), UNREACHABLE);
  assert(
    shape(body.database) === shape(UNREACHABLE),
    `expected the database section ${shape(UNREACHABLE)} in the body, got ${shape(body.database)}`,
  );
  assert(
    shape(body.queue) === shape(UNCONFIGURED_QUEUE),
    `expected the queue section carried through unchanged, got ${shape(body.queue)}`,
  );
}

// ---------------------------------------------------------------------------
// readinessFrom
// ---------------------------------------------------------------------------

export function assertReachableIsReady(): void {
  const expected: ReadinessResponse = { status: "ready", database: REACHABLE };
  const body = readinessFrom(REACHABLE);
  assert(shape(body) === shape(expected), `expected ${shape(expected)}, got ${shape(body)}`);
}

export function assertUnreachableIsNotReady(): void {
  const expected: ReadinessResponse = { status: "not_ready", database: UNREACHABLE };
  const body = readinessFrom(UNREACHABLE);
  assert(shape(body) === shape(expected), `expected ${shape(expected)}, got ${shape(body)}`);
}

// ---------------------------------------------------------------------------
// HealthController
// ---------------------------------------------------------------------------

export async function assertReadyAnswers200WhileTheDatabaseAnswers(): Promise<void> {
  const res = fakeResponse();
  const body = await controllerOver(REACHABLE).getReady(res as never);
  assert(res.statusCode === 200, `expected HTTP 200 while the database answers, got ${res.statusCode}`);
  assert(body.status === "ready", `expected status ready, got ${body.status}`);
}

export async function assertReadyAnswers503WhileTheDatabaseIsDown(): Promise<void> {
  const res = fakeResponse();
  const body = await controllerOver(UNREACHABLE).getReady(res as never);
  assert(res.statusCode === 503, `expected HTTP 503 while the database is down, got ${res.statusCode}`);
  assert(body.status === "not_ready", `expected status not_ready, got ${body.status}`);
}

export async function assertLivenessCarriesTheDatabaseAndStaysA200Body(): Promise<void> {
  const body = await controllerOver(UNREACHABLE).getHealth();
  assert(
    body.status === "degraded" && shape(body.database) === shape(UNREACHABLE),
    `expected /health to read degraded with ${shape(UNREACHABLE)}, got ${shape(body)}`,
  );
  // `/health` takes no Response, so it cannot set a non-200: the liveness rule
  // of ADR 0063 Amendment 1 holds by construction. The source row below pins it.
}

export function assertTheLivenessRouteTakesNoResponseObject(): void {
  const source = readRepoFile("apps/api/src/health/health.controller.ts");
  const getHealth = /async getHealth\(([^)]*)\)/.exec(source);
  assert(getHealth !== null, "expected an async getHealth(...) in health.controller.ts");
  assert(
    getHealth?.[1]?.trim() === "",
    `expected getHealth to take no parameter, so it can never set a status code, got (${getHealth?.[1] ?? ""})`,
  );
}
