import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import * as spec from "./user-grants.integration.spec";

/**
 * `F3.78` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the superuser pool.
 */
const connectionString = requireIntegrationDb({
  item: "F3.78",
  label: "the grants API's statements on bms_tenant",
  because:
    "whether a grant write lands depends on 0098's tenant_isolation policy on user_location_access, keyed on " +
    "the location's organization: its WITH CHECK raises 42501 on an insert and its USING filters a delete to " +
    "zero rows. A fake db proves neither.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F3.78 — grants API on bms_tenant (ADR 0089 decision 10)", { timeout: 60_000 }, () => {
  let superPool: pg.Pool;
  let superDb: BmsDb;

  beforeAll(async () => {
    superPool = await openIntegrationPool(connectionString as string, "F3.78");
    superDb = createDb(superPool);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("a location grant lands under withTenant of the location's organization on bms_tenant", async () => {
    await spec.assertALocationGrantLandsUnderTheLocationsOrganization(superDb);
  });

  it("the grant's audit row is stamped with the location's organization", async () => {
    await spec.assertTheGrantAuditRowIsStampedWithTheLocationsOrganization(superDb);
  });

  it("(a) an insert under the user's home organization for another organization's location raises 42501", async () => {
    await spec.assertAnInsertUnderTheHomeOrganizationRaises42501(superDb);
  });

  it("(a) the service maps the WITH CHECK refusal to a non-naming 409", async () => {
    await spec.assertTheServiceMapsTheWithCheckRefusalToANonNamingError(superDb);
  });

  it("(a) the refused insert leaves no grant and no audit row", async () => {
    await spec.assertTheRefusedInsertLeavesNoGrantAndNoAuditRow(superDb);
  });

  it("(b) a delete under the wrong GUC returns zero rows and the service answers 404 with no audit row", async () => {
    await spec.assertADeleteUnderTheWrongGucIs404WithNoAudit(superDb);
  });

  it("(b) positive control: the same delete under the location's organization removes the row", async () => {
    await spec.assertTheSameDeleteUnderTheRightGucRemovesTheRow(superDb);
  });
});
