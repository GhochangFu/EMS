import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertTheAcknowledgedItemNamesTheRtu,
  assertTheAffectedAssetsNameTheirRtus,
  assertTheClearedBroadcastNamesTheRtu,
  assertTheCreatedEventReadKeepsAnRtuLessAsset,
  assertTheDetailsKeepAnRtuLessAsset,
  assertTheDetailsNameTheRtu,
  assertTheListKeepsAnRtuLessAsset,
  assertTheListNamesTheRtu,
  assertTheTopAssetsNameTheirRtus,
  inRollback,
} from "./alarm-asset-label.integration.spec";

/**
 * `F4.316` PR 2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pool, as `alarm-lifecycle.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.316",
  label: "alarm producers name the asset's RTU and location",
  because:
    "the two fields come from LEFT JOINs to bms.rtus and bms.locations in five producers; a green run " +
    "without a database would claim every alarm row, socket payload, details response and stats row " +
    "names its RTU — and that an RTU-less asset keeps its alarm — while nothing ran the SQL.",
});

describe.skipIf(!connectionString)("F4.316 — alarm producers name the asset's RTU and location (ADR 0111)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.316");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  }, 60_000);

  it("the alarm list names the asset's RTU and location", () => inRollback(db, assertTheListNamesTheRtu));
  it("the alarm list keeps an RTU-less asset with assetRtuName null", () => inRollback(db, assertTheListKeepsAnRtuLessAsset));
  it("the acknowledged item names the RTU and location", () => inRollback(db, assertTheAcknowledgedItemNamesTheRtu));
  it("the created-event read keeps an RTU-less asset", () => inRollback(db, assertTheCreatedEventReadKeepsAnRtuLessAsset));
  it("the alarm details name the RTU and location", () => inRollback(db, assertTheDetailsNameTheRtu));
  it("the alarm details keep an RTU-less asset", () => inRollback(db, assertTheDetailsKeepAnRtuLessAsset));
  it("the affected assets name each asset's RTU, or null", () => inRollback(db, assertTheAffectedAssetsNameTheirRtus));
  it("the stats top assets name each asset's RTU, or null", () => inRollback(db, assertTheTopAssetsNameTheirRtus));
  it("the lifecycle sweep's cleared broadcast names the RTU", () => inRollback(db, assertTheClearedBroadcastNamesTheRtu), 30_000);
});
