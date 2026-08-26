import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { AlarmsService } from "../alarms/alarms.service";
import { LocationsAdminService } from "../admin/locations/locations.service";
import { TelemetryImportService } from "../admin/telemetry-import/telemetry-import.service";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { ReportsService } from "../reports/reports.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "./database.tokens";

/**
 * `E7.1b` — the one wiring guard for "these cross-org reads run on the fleet
 * (BYPASSRLS) pool, not the tenant pool" (ADR 0043 Amendment 3).
 *
 * The `.rls.integration` proofs each show a read goes **dark** on a bare tenant
 * pool — that is a *necessity* proof (the read has to be on fleet for the
 * feature to work at all). But every one of them constructs its service with
 * explicit pools, so none gates the `@Inject` token itself: reverting a
 * `FLEET_*` decorator to `TENANT_*` leaves all of them green. That is the exact
 * overclaim `locations.rls.integration.spec.ts` was corrected for. This test is
 * what actually gates the wiring — the revert fails **here**.
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

describe("E7.1b — cross-org reads inject the fleet pool, not the tenant pool", () => {
  it("CalcDefinitionsService reads the cross-org calc cache on FLEET_DRIZZLE (arg 0)", () => {
    expect(injectedToken(CalcDefinitionsService, 0)).toBe(FLEET_DRIZZLE);
  });

  it("ReportsService reads the energy report on FLEET_POOL (arg 0)", () => {
    expect(injectedToken(ReportsService, 0)).toBe(FLEET_POOL);
  });

  it("TelemetryImportService resolves asset codes on FLEET_DRIZZLE (arg 0)", () => {
    expect(injectedToken(TelemetryImportService, 0)).toBe(FLEET_DRIZZLE);
  });

  it("AlarmsService reads on FLEET_DRIZZLE (arg 1) and writes on TENANT_DRIZZLE (arg 0)", () => {
    expect(injectedToken(AlarmsService, 1)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(AlarmsService, 0)).toBe(TENANT_DRIZZLE);
  });

  it("LocationsAdminService reads on FLEET_DRIZZLE (arg 0) and writes on TENANT_DRIZZLE (arg 1)", () => {
    expect(injectedToken(LocationsAdminService, 0)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(LocationsAdminService, 1)).toBe(TENANT_DRIZZLE);
  });

  it("WorkOrdersService reads on FLEET_DRIZZLE (arg 0) and writes on TENANT_DRIZZLE (arg 1)", () => {
    expect(injectedToken(WorkOrdersService, 0)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(WorkOrdersService, 1)).toBe(TENANT_DRIZZLE);
  });
});
