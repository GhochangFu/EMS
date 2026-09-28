import pg from "pg";

import { DatabaseHealthService } from "./database-health.service";
import { HealthController } from "./health.controller";

/**
 * `F4.175` (ADR 0063 Amendment 3) — the readiness probe against real pools.
 *
 * `database-health.spec.ts` proves the route over fake readers. This file
 * proves the reader the route is wired to: `DatabaseHealthService` over a pool
 * that reaches Postgres answers `reachable`, and over a pool whose server is
 * not there answers `unreachable` inside the health budget — and
 * `GET /health/ready` turns those into 200 and 503. The row asks for the
 * non-200 while the database is unreachable and the 200 after; two pools
 * stand in for "down" and "up" so no suite here stops the shared Postgres
 * other suites run against.
 *
 * The unreachable pool points at `127.0.0.1:1`. Nothing listens on port 1, so
 * the connect is refused at once; the timeout row in the pure spec covers the
 * server that accepts and never answers.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const UNREACHABLE_URL = "postgres://bms_fleet:unused@127.0.0.1:1/bms";

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

function controllerOver(pool: pg.Pool): HealthController {
  return new HealthController(
    { read: () => Promise.resolve({ status: "ok", queue: {} }) } as never,
    new DatabaseHealthService(pool),
  );
}

export async function assertAReachablePoolReadsReachable(pool: pg.Pool): Promise<void> {
  const health = await new DatabaseHealthService(pool).read();
  assert(health.reachable, `expected reachable over a pool that reaches Postgres, got ${JSON.stringify(health)}`);
}

export async function assertARefusedPoolReadsUnreachableInsideTheBudget(pool: pg.Pool): Promise<void> {
  const started = Date.now();
  const health = await new DatabaseHealthService(pool).read();
  const elapsed = Date.now() - started;
  assert(!health.reachable, `expected unreachable over a refused pool, got ${JSON.stringify(health)}`);
  assert(elapsed < 2_500, `expected the read inside the 2 s budget, and it took ${elapsed} ms`);
}

export async function assertReadyIs503WhileDownAnd200WhileUp(
  down: pg.Pool,
  up: pg.Pool,
): Promise<void> {
  const whileDown = fakeResponse();
  const downBody = await controllerOver(down).getReady(whileDown as never);
  assert(
    whileDown.statusCode === 503 && downBody.status === "not_ready",
    `expected 503 not_ready while the database is unreachable, got ${whileDown.statusCode} ${downBody.status}`,
  );

  const whileUp = fakeResponse();
  const upBody = await controllerOver(up).getReady(whileUp as never);
  assert(
    whileUp.statusCode === 200 && upBody.status === "ready",
    `expected 200 ready while the database answers, got ${whileUp.statusCode} ${upBody.status}`,
  );
}

export function refusedPool(): pg.Pool {
  const pool = new pg.Pool({ connectionString: UNREACHABLE_URL, max: 1 });
  // A refused connect emits no pool 'error' (that event is for idle clients),
  // but the listener is the F4.173 rule for every pool this repo creates.
  pool.on("error", () => {});
  return pool;
}
