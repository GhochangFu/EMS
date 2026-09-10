import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertDeviceTimeColumnExists,
  assertSecondDeliveryMovesDeviceTime,
} from "./normaliser.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `F4.57` / ADR 0061 Amendment 1 item 1 — Vitest entry point. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * Run it against your own stack (docker-compose.override.yml remaps the
 * published port to 5433; 5432 is the committed default):
 *
 *   DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5433/bms \
 *     pnpm vitest run --project ingest apps/ingest/src/host/normaliser.integration.test.ts
 */

const connectionString = requireIntegrationDb({
  item: "F4.57",
  label: "device_time upsert tests",
  because:
    "normaliser.spec.ts reads the SQL buildUpsert produces as text, which is green against a " +
    "schema that never ran migration 0069 and green against a DO UPDATE clause Postgres would " +
    "reject. These are the only assertions that the device_time column exists as timestamptz " +
    "and nullable, and that a second delivery's EXCLUDED.device_time actually replaces the " +
    "first delivery's stamp (ADR 0061 Amendment 1 item 1).",
});

describe.skipIf(!connectionString)("F4.57 — device_time on the point_values upsert", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.57");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("has a nullable timestamptz device_time column, so migration 0069 ran here", async () => {
    await assertDeviceTimeColumnExists(pool as pg.Pool);
  });

  it("moves the stored device_time on a second delivery, and clears it on one carrying none", async () => {
    await assertSecondDeliveryMovesDeviceTime(pool as pg.Pool);
  });
});
