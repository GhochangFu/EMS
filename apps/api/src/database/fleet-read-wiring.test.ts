import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { LocationsAdminService } from "../admin/locations/locations.service";
import { TelemetryImportService } from "../admin/telemetry-import/telemetry-import.service";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { ReportsService } from "../reports/reports.service";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "./database.tokens";

/**
 * `E7.1b` — the one wiring guard for the reads that run **unconditionally** on
 * the fleet (BYPASSRLS) pool: the cross-org calc cache, the energy report, the
 * telemetry-import asset-code resolution, and the `locations` master-data reads
 * (a decision-2 fleet-wide surface, ADR 0043).
 *
 * The `.rls.integration` proofs each construct their service with explicit
 * pools, so none gates the `@Inject` token itself: reverting a `FLEET_*`
 * decorator to `TENANT_*` leaves all of them green. That is the exact overclaim
 * `locations.rls.integration.spec.ts` was corrected for. This test is what
 * actually gates that wiring — the revert fails **here**.
 *
 * It does **not** gate the four conformed decision-1 LIST reads (`alarms`,
 * `work-orders`, `maintenance`, `rules`). Those inject **both** the fleet and
 * tenant tokens — before and after the conform — because they route through
 * `withReadScope` (single-org → `withTenant`, admin/multi-org → fleet). A token
 * assertion cannot tell the routed case apart, so each of those services carries
 * its own `.transaction` counter assertion in its `.rls.integration` pair, which
 * fails when `list` reverts to a bare `fleetDb.select`.
 *
 * It reads Nest's own `SELF_DECLARED_DEPS_METADATA` (`'self:paramtypes'`), the
 * array of `{ index, param }` entries every `@Inject(token)` records on the
 * class — no database, no instantiation. Importing each service applies its
 * decorators, which is all this needs.
 */
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

function injectedToken(target: unknown, index: number): unknown {
  const deps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target as object) as
      | { index: number; param: unknown }[]
      | undefined) ?? [];
  return deps.find((d) => d.index === index)?.param;
}

describe("E7.1b — unconditional cross-org reads inject the fleet pool, not the tenant pool", () => {
  it("CalcDefinitionsService reads the cross-org calc cache on FLEET_DRIZZLE (arg 0)", () => {
    expect(injectedToken(CalcDefinitionsService, 0)).toBe(FLEET_DRIZZLE);
  });

  it("ReportsService reads the energy report on FLEET_POOL (arg 0)", () => {
    expect(injectedToken(ReportsService, 0)).toBe(FLEET_POOL);
  });

  it("TelemetryImportService resolves asset codes on FLEET_DRIZZLE (arg 0)", () => {
    expect(injectedToken(TelemetryImportService, 0)).toBe(FLEET_DRIZZLE);
  });

  it("LocationsAdminService reads on FLEET_DRIZZLE (arg 0) and writes on TENANT_DRIZZLE (arg 1)", () => {
    expect(injectedToken(LocationsAdminService, 0)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(LocationsAdminService, 1)).toBe(TENANT_DRIZZLE);
  });
});
