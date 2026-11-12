import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { inRollback } from "./alarm-asset-label.integration.spec";
import {
  assertEachSourceNamesItsOwnLocation,
  assertTheAcknowledgeCarriesTheRank,
  assertTheClearedBroadcastCarriesTheRank,
  assertTheCreatedEventReadCarriesTheRank,
  assertTheListCarriesTheRank,
} from "./alarm-severity-rank.integration.spec";

/**
 * `F4.357` U1 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pool, as `alarm-asset-label.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.357",
  label: "alarm producers carry severityRank and locationName",
  because:
    "the alarm bar's popup, blink and tone read severityRank from every producer's row; a green run " +
    "without a database would claim each producer carries the stored rank and the alarm's own location " +
    "while nothing ran the two sub-selects.",
});

describe.skipIf(!connectionString)("F4.357 — alarm producers carry severityRank and locationName (ADR 0130 decision 17)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.357");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  }, 60_000);

  it("the alarm list carries each alarm's stored rank", () => inRollback(db, assertTheListCarriesTheRank));
  it("the acknowledge return and its broadcast carry the rank", () => inRollback(db, assertTheAcknowledgeCarriesTheRank));
  it("the created-event read carries the rank", () => inRollback(db, assertTheCreatedEventReadCarriesTheRank));
  it("the sweep's cleared broadcast carries the rank and the location", () => inRollback(db, assertTheClearedBroadcastCarriesTheRank), 30_000);
  it("each source names its own location: the asset's, the RTU's, none", () => inRollback(db, assertEachSourceNamesItsOwnLocation));
});
