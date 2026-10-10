import { randomUUID } from "node:crypto";

import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { buildTreeFixture, type TreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  aCampusRowServesADeeperAssetWithNoRowOfItsOwn,
  anAssetPointingAtAForeignNodeGetsNoChainThere,
  aPlantedCrossOrgEdgeIsNotWalked,
  aPlantedCycleTerminatesAndStillResolves,
  aSiblingSubtreeRowIsNotServed,
  theAncestorRowBeatsTheOrganizationRow,
  theOwnNodeRowBeatsTheAncestorRow,
} from "./calc-parameters.tree.integration.spec";
import { CalcParametersService } from "./calc-parameters.service";

/**
 * `F2.10` — Vitest entry point for the calc parameter ancestor walk.
 * Assertions live in the sibling `.spec` (§4.6). `DATABASE_URL` is read as
 * the **superuser**: the planted cases switch `session_replication_role`.
 * The pool has `max: 1`, so `BEGIN` opens the one transaction every later
 * query — the service's included — runs inside, and `afterAll` rolls it back
 * (the `location-tree.integration.test.ts` lifecycle).
 */
const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "calc parameter ancestor walk",
  because:
    "nearest-first resolution along the location tree, and a planted cross-organization edge that " +
    "the walk must not cross, are database behaviours a pure test cannot check.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F2.10 — calc parameters resolve nearest-first along the ancestors", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let svc: CalcParametersService;
  let fx: TreeFixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.10", { max: 1 });
    svc = new CalcParametersService(createDb(pool));
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    fx = await buildTreeFixture(pool, run);
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("a row on A serves A1a two levels below, which has no row of its own", async () => {
    await aCampusRowServesADeeperAssetWithNoRowOfItsOwn(svc, pool as pg.Pool, fx, run);
  });

  it("the nearer ancestor's row beats the farther one", async () => {
    await theOwnNodeRowBeatsTheAncestorRow(svc, pool as pg.Pool, fx, run);
  });

  it("an ancestor row beats the organization row", async () => {
    await theAncestorRowBeatsTheOrganizationRow(svc, pool as pg.Pool, fx, run);
  });

  it("a row on the sibling subtree is not served", async () => {
    await aSiblingSubtreeRowIsNotServed(svc, pool as pg.Pool, fx, run);
  });

  it("a planted cross-organization edge is not walked (beside an unguarded positive control)", async () => {
    await aPlantedCrossOrgEdgeIsNotWalked(svc, pool as pg.Pool, fx, run);
  });

  it("a planted cycle terminates at the bound and the organization row still resolves", async () => {
    await aPlantedCycleTerminatesAndStillResolves(svc, pool as pg.Pool, fx, run);
  });

  it("an asset pointing at another organization's node gets no chain there, with that organization in the batch", async () => {
    await anAssetPointingAtAForeignNodeGetsNoChainThere(svc, pool as pg.Pool, fx, run);
  });
});
