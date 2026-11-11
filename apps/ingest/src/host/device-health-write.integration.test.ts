import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";

import {
  assertAFailureRollsTheBeatBack,
  assertFlushesSumAndKeepTheFirstPoint,
  assertLastSeenOnlyMovesForward,
  assertMonitoredSinceFollowsThePlan,
  assertTenantReadsOnlyItsOwn,
  cleanUp,
  type Fixture,
  plantFixture,
} from "./device-health-write.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `F3.16` / ADR 0127 — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the two pools and the per-case fixture.
 */

const connectionString = requireIntegrationDb({
  item: "F3.16",
  label: "device health flush tests",
  because:
    "device-health.spec.ts never runs the SQL, so it is green against a schema without migration " +
    "0149, an upsert that sums wrongly, a last_seen_at that moves backwards, and a flush whose " +
    "failure leaves the heartbeat committed.",
});

/** `bms_tenant`'s URL, derived from the fleet URL the gate returned (`DATABASE_URL_TENANT` wins). */
function tenantUrl(fleetUrl: string): string {
  const explicit = process.env.DATABASE_URL_TENANT;
  if (explicit) {
    return explicit;
  }
  const parsed = new URL(fleetUrl);
  parsed.username = "bms_tenant";
  parsed.password = process.env.BMS_TENANT_PASSWORD ?? "bms_tenant_dev";
  return parsed.toString();
}

describe.skipIf(!connectionString)("F3.16 — the device health flush on a real database", () => {
  let fleet: pg.Pool | undefined;
  let tenant: pg.Pool | undefined;
  let fixture: Fixture | undefined;

  beforeAll(async () => {
    fleet = await openIntegrationPool(connectionString as string, "F3.16");
    tenant = await openIntegrationPool(tenantUrl(connectionString as string), "F3.16");
  });

  beforeEach(async () => {
    fixture = await plantFixture(fleet as pg.Pool);
  });

  afterEach(async () => {
    await cleanUp(fleet as pg.Pool, fixture);
    fixture = undefined;
  });

  afterAll(async () => {
    await tenant?.end();
    await fleet?.end();
  });

  it("sums two flushes, keeps the first point, and writes nothing for an unknown RTU", async () => {
    await assertFlushesSumAndKeepTheFirstPoint(fleet as pg.Pool, fixture as Fixture);
  });

  it("never moves last_seen_at back for an older receive time", async () => {
    await assertLastSeenOnlyMovesForward(fleet as pg.Pool, fixture as Fixture);
  });

  it("stamps and clears monitored_since from the plan", async () => {
    await assertMonitoredSinceFollowsThePlan(fleet as pg.Pool, fixture as Fixture);
  });

  it("rolls the beat back with a failing statement", async () => {
    await assertAFailureRollsTheBeatBack(fleet as pg.Pool, fixture as Fixture);
  });

  it("lets bms_tenant read only its own organization's rows and write none", async () => {
    await assertTenantReadsOnlyItsOwn(fleet as pg.Pool, tenant as pg.Pool, fixture as Fixture);
  });
});
