import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAReachablePoolReadsReachable,
  assertARefusedPoolReadsUnreachableInsideTheBudget,
  assertReadyIs503WhileDownAnd200WhileUp,
  refusedPool,
} from "./database-health.integration.spec";
import { requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.175` — Vitest entry point. Assertions live in the sibling `.spec` (ADR
 * 0014); see its header for what the suite holds.
 */

const connectionString = requireIntegrationDb({
  item: "F4.175",
  label: "DatabaseHealthService and GET /health/ready against real pools",
  because:
    "the pure spec proves the route over fakes; only a real pool proves that the reader the " +
    "route is wired to answers unreachable for a refused server and reachable for a live one.",
});

describe.skipIf(!connectionString)("F4.175 — readiness against real pools", () => {
  let up: pg.Pool;
  let down: pg.Pool;

  beforeAll(() => {
    up = new pg.Pool({ connectionString, max: 1 });
    up.on("error", () => {});
    down = refusedPool();
  });

  afterAll(async () => {
    await Promise.all([up.end(), down.end()]);
  });

  it("reads reachable over a pool that reaches Postgres", async () => {
    await assertAReachablePoolReadsReachable(up);
  });

  it("reads unreachable over a refused pool, inside the budget", async () => {
    await assertARefusedPoolReadsUnreachableInsideTheBudget(down);
  }, 5_000);

  it("GET /health/ready answers 503 while down and 200 while up", async () => {
    await assertReadyIs503WhileDownAnd200WhileUp(down, up);
  }, 5_000);
});
