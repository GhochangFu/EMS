import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAConnectionConfigForThisRtuResolvesToMqtt,
  assertADisabledMqttRtuResolvesToCatalog,
  assertAnEnabledCatalogRtuWithNoConfigResolvesToCatalog,
  assertAnEnabledMqttRtuResolvesToMqtt,
  assertAnEnabledSimulatorRtuResolvesToCatalog,
  assertAnotherRtusConnectionConfigDoesNotCount,
  type PredicateCtx,
} from "./telemetry-source.integration.spec";

/**
 * `F4.139` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * There is no `afterAll` fixture delete: every case runs inside `withRollback`
 * and discards its own rows. The pool is the only thing to close.
 */
const connectionString = requireIntegrationDb({
  item: "F4.139",
  label: "the shared telemetrySource predicate",
  because:
    "this one function decides which of two processes writes an asset's samples, " +
    "for three callers. Skipping leaves nothing checking that a simulator RTU is " +
    "not handed to the ingest host, that a disabled RTU's assets go back to the " +
    "simulator, or that a connection-config row is read for the RTU asked about " +
    "rather than for whichever one was configured first — and every one of those " +
    "failures is silent: duplicate writers on one sample, or dead points.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

describe.skipIf(!connectionString)("F4.139 — resolveTelemetrySource", () => {
  let fixturePool: pg.Pool;
  let ctx: PredicateCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039): the fixture inserts and the predicate's own read run on
    // the same transaction, with no `app.current_organization` set.
    fixturePool = await openIntegrationPool(url, "F4.139");

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `F4.139: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }

    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `F4.139: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }

    ctx = {
      fleetDb: createDb(fixturePool),
      organizationId: org.rows[0].id,
      locationId: loc.rows[0].id,
    };
  }, 60_000);

  afterAll(async () => {
    await fixturePool?.end();
  }, 60_000);

  // One claim per `it`: `expect` throws, so two directions in one block would
  // hide the second whenever the first fails.
  it("P1 — hands an enabled mqtt RTU to the ingest host", async () => {
    await assertAnEnabledMqttRtuResolvesToMqtt(ctx);
  }, 30_000);

  it("P2 — leaves an enabled catalog RTU with no connection config on catalog", async () => {
    await assertAnEnabledCatalogRtuWithNoConfigResolvesToCatalog(ctx);
  }, 30_000);

  it("P3 — leaves an enabled simulator RTU on catalog", async () => {
    await assertAnEnabledSimulatorRtuResolvesToCatalog(ctx);
  }, 30_000);

  it("P4 — reads a connection config for this RTU as a declared protocol", async () => {
    await assertAConnectionConfigForThisRtuResolvesToMqtt(ctx);
  }, 30_000);

  it("P5 — returns catalog for a disabled RTU whatever it declares", async () => {
    await assertADisabledMqttRtuResolvesToCatalog(ctx);
  }, 30_000);

  it("P6 — ignores another RTU's connection config", async () => {
    await assertAnotherRtusConnectionConfigDoesNotCount(ctx);
  }, 30_000);
});
