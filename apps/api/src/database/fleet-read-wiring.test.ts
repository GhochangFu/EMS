import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { AlarmsService } from "../alarms/alarms.service";
import { LocationsAdminService } from "../admin/locations/locations.service";
import { TelemetryImportService } from "../admin/telemetry-import/telemetry-import.service";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { ReportsService } from "../reports/reports.service";
import { RulesService } from "../rules/rules.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "./database.tokens";

/**
 * `E7.1b` — the one wiring guard for **which token lands in which constructor
 * slot**. Two kinds of service depend on it:
 *
 *  - the unconditional fleet reads (calc cache, energy report, telemetry-import
 *    asset resolution, `locations` master data — a decision-2 surface, ADR 0043);
 *  - the four conformed decision-1 LIST services (`alarms`, `work-orders`,
 *    `maintenance`, `rules`), which inject **both** a fleet and a tenant token —
 *    and whose slot order is deliberately **not** uniform (`AlarmsService` and
 *    `RulesService` take tenant first; `WorkOrdersService` and
 *    `MaintenanceService` take fleet first).
 *
 * The `.rls.integration` proofs each construct their service with explicit
 * pools, so none gates the `@Inject` token itself: reverting or swapping a
 * `FLEET_*`/`TENANT_*` decorator leaves them green. That is the exact overclaim
 * `locations.rls.integration.spec.ts` was corrected for. This test gates the
 * slots — the swap fails **here**. It matters because `withReadScope(this.db,
 * this.fleetDb, …)` reads its constructor args positionally: swap the two on any
 * conformed service and org resolution runs on the GUC-less tenant pool (every
 * list goes silently `onEmpty`) or a GUC is set on the ignored BYPASSRLS pool.
 *
 * A separate concern is the **runtime routing** inside each conformed `list`
 * (single-org → `withTenant`, admin/multi-org → fleet). A token assertion cannot
 * see that, so each conformed service carries a `.transaction` counter in its
 * own `.rls.integration` pair, which fails when `list` reverts to a bare
 * `fleetDb.select`. The two guards are complementary: this one pins the slots,
 * the counter pins the routing.
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

describe("E7.1b — services inject the right pool token in the right constructor slot", () => {
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

  // The four conformed decision-1 services inject both tokens; the slots are
  // load-bearing because withReadScope(this.db, this.fleetDb, …) reads them
  // positionally. Runtime routing is gated by each service's .transaction counter.
  it("AlarmsService injects TENANT_DRIZZLE (arg 0) and FLEET_DRIZZLE (arg 1)", () => {
    expect(injectedToken(AlarmsService, 0)).toBe(TENANT_DRIZZLE);
    expect(injectedToken(AlarmsService, 1)).toBe(FLEET_DRIZZLE);
  });

  it("WorkOrdersService injects FLEET_DRIZZLE (arg 0) and TENANT_DRIZZLE (arg 1)", () => {
    expect(injectedToken(WorkOrdersService, 0)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(WorkOrdersService, 1)).toBe(TENANT_DRIZZLE);
  });

  it("MaintenanceService injects FLEET_DRIZZLE (arg 0) and TENANT_DRIZZLE (arg 1)", () => {
    expect(injectedToken(MaintenanceService, 0)).toBe(FLEET_DRIZZLE);
    expect(injectedToken(MaintenanceService, 1)).toBe(TENANT_DRIZZLE);
  });

  it("RulesService injects TENANT_DRIZZLE (arg 0) and FLEET_DRIZZLE (arg 1)", () => {
    expect(injectedToken(RulesService, 0)).toBe(TENANT_DRIZZLE);
    expect(injectedToken(RulesService, 1)).toBe(FLEET_DRIZZLE);
  });
});
