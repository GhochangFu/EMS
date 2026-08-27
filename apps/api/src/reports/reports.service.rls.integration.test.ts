import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertForeignPvFixtureIsNotAdopted,
  assertReportGoesDarkOnBareTenant,
  assertReportResolvesOnFleet,
  assertReportResolvesWithOrgGuc,
  cleanupEnergyFixture,
  setUpEnergyFixture,
  type EnergyRlsFixture,
} from "./reports.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point for the energy-report RLS proof. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * `connection: "owner"` because this suite writes telemetry and refreshes the
 * production continuous aggregates via `SET ROLE bms_rollup` — the fleet fixture
 * connection holds neither privilege. The fleet, bare-tenant and org-scoped
 * tenant pools it needs are all derived from that owner URL.
 */

const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "energy report RLS proof",
  because:
    "the report joins `bms.assets` (0047 FORCE) to a telemetry continuous aggregate, so whether " +
    "topConsumers empties and solar is misattributed on a bare tenant pool is engine behaviour a " +
    "pure test cannot check.",
  connection: "owner",
});

describe.skipIf(!connectionString)(
  "E7.1b — the energy report goes dark on a bare tenant pool",
  () => {
    let ownerPool: pg.Pool | undefined;
    let fleetPool: pg.Pool | undefined;
    let bareTenantPool: pg.Pool | undefined;
    let gucTenantPool: pg.Pool | undefined;
    let fx: EnergyRlsFixture | undefined;

    beforeAll(async () => {
      const cs = connectionString as string;
      ownerPool = await openIntegrationPool(cs, "E7.1b");
      fleetPool = await openIntegrationPool(
        process.env.DATABASE_URL_FLEET ?? asRole(cs, "bms_fleet", "bms_fleet_dev"),
        "E7.1b",
      );
      const tenantUrl =
        process.env.DATABASE_URL_TENANT ?? asRole(cs, "bms_tenant", "bms_tenant_dev");
      bareTenantPool = await openIntegrationPool(tenantUrl, "E7.1b");

      fx = await setUpEnergyFixture(ownerPool, fleetPool);

      // The positive-control pool: the same tenant role, but its one connection
      // carries `app.current_organization` for the fixture org. `max: 1` plus an
      // awaited pre-warm sets the session GUC deterministically before any
      // `ReportsService` read runs — a `connect`-event handler would race the
      // first query instead (pg warns, and the SET might not win). Session-level
      // `set_config` (the `false`) persists across checkouts of that connection.
      //
      // `idleTimeoutMillis: 0` disables the reaper. The GUC lives on that one
      // physical connection, and it sits idle through the fleet and bare-tenant
      // legs; at pg's 10 s default it could be closed before the third leg runs,
      // which would hand that leg a fresh, GUC-less connection and fail the
      // positive control spuriously. This is why the pool is built directly
      // rather than through `openIntegrationPool`, which exposes no such option —
      // `tenantUrl` was already proven reachable for `bareTenantPool`, and the
      // awaited `connect()` below fails loudly if this one is not.
      const scoped = new pg.Pool({ connectionString: tenantUrl, max: 1, idleTimeoutMillis: 0 });
      const warm = await scoped.connect();
      await warm.query("SELECT set_config('app.current_organization', $1, false)", [
        fx.organizationId,
      ]);
      warm.release();
      gucTenantPool = scoped;
    }, 180_000);

    afterAll(async () => {
      if (ownerPool && fx) {
        await cleanupEnergyFixture(ownerPool, fx);
      }
      for (const pool of [gucTenantPool, bareTenantPool, fleetPool, ownerPool]) {
        await pool?.end().catch(() => undefined);
      }
    }, 120_000);

    it("resolves the full report on the fleet pool (positive control)", async () => {
      if (!fleetPool || !fx) throw new Error("fixture required");
      await assertReportResolvesOnFleet(fleetPool, fx);
    });

    it("empties topConsumers and misattributes solar on a bare tenant pool", async () => {
      if (!bareTenantPool || !fx) throw new Error("fixture required");
      await assertReportGoesDarkOnBareTenant(bareTenantPool, fx);
    });

    it("resolves again on the same tenant role once the org GUC is set", async () => {
      if (!gucTenantPool || !fx) throw new Error("fixture required");
      await assertReportResolvesWithOrgGuc(gucTenantPool, fx);
    });

    /**
     * `F4.67` — not about RLS. It gates the fixture resolution itself, which used
     * to adopt `rollup-conversion.integration.spec.ts`'s committed `PV-F428-PROBE`
     * whenever the two files ran in one Vitest invocation. Plants a decoy inside
     * its own rolled-back transaction, so the guard cannot become the hazard.
     */
    it("does not adopt a foreign PV-prefixed fixture asset", async () => {
      if (!fleetPool || !fx) throw new Error("fixture required");
      await assertForeignPvFixtureIsNotAdopted(fleetPool, fx);
    });
  },
);
