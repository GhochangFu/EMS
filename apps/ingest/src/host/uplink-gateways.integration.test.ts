import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assertPostgresSha256AuthenticatesThroughTheQuery } from "./uplink-gateways.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `E7.2` / ADR 0123 decision 5 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "E7.2",
  label: "uplink gateway snapshot tests",
  because:
    "uplink-gateways.spec.ts hashes with Node on both sides and never runs GATEWAY_QUERY, so it " +
    "is green against a schema without migration 0141 and green if the stored hash and the " +
    "presented token's digest are computed differently.",
});

describe.skipIf(!connectionString)("E7.2 — the uplink gateway snapshot on a real database", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E7.2");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("authenticates a token whose hash Postgres planted with sha256()", async () => {
    await assertPostgresSha256AuthenticatesThroughTheQuery(pool as pg.Pool);
  });
});
