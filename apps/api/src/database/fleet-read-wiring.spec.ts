import "reflect-metadata";
import { expect } from "vitest";

import { AdvisoriesService } from "../advisories/advisories.service";
import { AlarmNotifyService } from "../alarms/alarm-notify.service";
import { AlarmRaiser } from "../alarms/alarm-raise.service";
import { AlarmRootCauseService } from "../alarms/alarm-root-cause.service";
import { AlarmsService } from "../alarms/alarms.service";
import { DeviceProfilesAdminService } from "../admin/device-profiles/device-profiles.service";
import { LocationsAdminService } from "../admin/locations/locations.service";
import { TelemetryImportService } from "../admin/telemetry-import/telemetry-import.service";
import { HealthInputsService } from "../asset-health/health-inputs.service";
import { AssetImagesService } from "../assets/asset-images.service";
import { AssetImagesWriteService } from "../assets/asset-images-write.service";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { CopilotPurgeService } from "../copilot/copilot-purge.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { DegradationService } from "../degradation/degradation.service";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { MaintenanceWindowsService } from "../maintenance-windows/maintenance-windows.service";
import { MlAnomaliesService } from "../ml/ml-anomalies.service";
import { MlFindingsService } from "../ml/ml-findings.service";
import { FindingsParagraphService } from "../ml-findings/findings-paragraph.service";
import { MlForecastsService } from "../ml/ml-forecasts.service";
import { QUEUE_CLIENT } from "../queue/queue.tokens";
import { WorkerHostService } from "../queue/worker-host.service";
import { ReportDispatchService } from "../reports/report-dispatch.service";
import { ReportFilesService } from "../reports/report-files.service";
import { ReportScopeService } from "../reports/report-scope";
import { ReportRenderService } from "../reports/report-render.service";
import { ReportSchedulesService } from "../reports/report-schedules.service";
import { ReportsService } from "../reports/reports.service";
import { RuleSweepService } from "../rules/rule-sweep.service";
import { RulesService } from "../rules/rules.service";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { FilterOptionsService } from "../filter-options/filter-options.service";
import { CredentialRotationService } from "../security/credential-rotation.service";
import { TelemetryService } from "../telemetry/telemetry.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE, TENANT_POOL } from "./database.tokens";

/**
 * `E7.1b` — the one wiring guard for **which token lands in which constructor
 * slot**. Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014). Two kinds of service depend on it:
 *
 *  - the unconditional fleet reads (calc cache, energy report, the dashboard
 *    since `F4.159` joined `bms.assets` into every kW and PUE sum, telemetry-import
 *    asset resolution, `locations` master data — a decision-2 surface, ADR 0043 —
 *    and `E8.4`'s credential rotation walk, ADR 0062 decision 6, whose every
 *    integration proof runs on an explicit transaction so this is its only gate);
 *  - the four conformed decision-1 LIST services (`alarms`, `work-orders`,
 *    `maintenance`, `rules`), which inject **both** a fleet and a tenant token —
 *    and whose slot order is deliberately **not** uniform (`AlarmsService` and
 *    `RulesService` take tenant first; `WorkOrdersService` and
 *    `MaintenanceService` take fleet first);
 *  - `F4.24`'s `WorkerHostService` (ADR 0063 decision 6), which hands both
 *    pools to `runProcessor` as `{ tenantDb, fleetDb }` — no test boots
 *    `WorkerModule` (Amendment 1), so this is the only gate that the tenant
 *    pool lands in slot 1 and the fleet pool in slot 2. `F3.11` appended two
 *    slots after `metrics`; the two rows below are the proof the append
 *    shifted nothing;
 *  - `F3.11`'s three worker-side services (ADR 0064 decisions 3, 4, 6):
 *    `RuleSweepService` and `AlarmRaiser` inject the **tenant** pool only —
 *    the sweep's fleet handle arrives as `run(fleetDb)`'s argument from the
 *    `fleet`-tenancy processor, and the raiser's every write runs under
 *    `withTenant` — while `AlarmNotifyService` reads the alarm it was
 *    `NOTIFY`ed about on the **fleet** pool, since a `LISTEN` payload carries
 *    an id and no session GUC. Each `.rls.integration` proof constructs its
 *    service with explicit pools, so this is the only gate on the token.
 *
 * The `.rls.integration` proofs each construct their service with explicit
 * pools, so none gates the `@Inject` token itself: reverting or swapping a
 * `FLEET_*`/`TENANT_*` decorator leaves them green. That is the exact overclaim
 * `locations.rls.integration.spec.ts` was corrected for. This gates the slots —
 * the swap fails **here**. It matters because `withReadScope(this.db,
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

/** The services whose reads run unconditionally on the fleet (BYPASSRLS) pool. */
export function assertUnconditionalFleetReadSlots(): void {
  expect(injectedToken(CalcDefinitionsService, 0)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(ReportsService, 0)).toBe(FLEET_POOL);
  // F4.159: every kW and PUE sum joins bms.assets (FORCE RLS), so on any other
  // pool the dashboard reads zero with no error.
  expect(injectedToken(DashboardService, 0)).toBe(FLEET_POOL);
  expect(injectedToken(TelemetryImportService, 0)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(LocationsAdminService, 0)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(LocationsAdminService, 1)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(CredentialRotationService, 0)).toBe(FLEET_DRIZZLE);
}

/**
 * `F4.290` — `ReportScopeService` reads the named locations' organizations for
 * the global admin before any tenant is known: slot 0 is the fleet handle.
 */
export function assertReportScopeServiceFleetSlot(): void {
  expect(injectedToken(ReportScopeService, 0)).toBe(FLEET_DRIZZLE);
}

/**
 * `F4.361` (ADR 0132) — `AssetFilterScopeService(fleetDb, accessControl)`
 * narrows a list's asset scope before any tenant is known: slot 0 is the
 * fleet handle, or the group check and the assets read run under no GUC on
 * the tenant pool and every filter answers empty.
 */
export function assertAssetFilterScopeServiceFleetSlot(): void {
  expect(injectedToken(AssetFilterScopeService, 0)).toBe(FLEET_DRIZZLE);
}

/** `F4.361` U3 — `FilterOptionsService(fleetDb, accessControl)`: the options span every organization the caller reads. */
export function assertFilterOptionsServiceFleetSlot(): void {
  expect(injectedToken(FilterOptionsService, 0)).toBe(FLEET_DRIZZLE);
}

/**
 * The four conformed decision-1 services inject both tokens; the slot order is
 * non-uniform on purpose, so each is pinned explicitly.
 */
export function assertConformedServiceSlots(): void {
  expect(injectedToken(AlarmsService, 0)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(AlarmsService, 1)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(WorkOrdersService, 0)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(WorkOrdersService, 1)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(MaintenanceService, 0)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(MaintenanceService, 1)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(RulesService, 0)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(RulesService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F4.24` — `WorkerHostService(client, tenantDb, fleetDb, metrics)`. Two
 * claims, one function each: `expect` throws, so a bundled pair would only
 * ever report the first slot.
 */
export function assertWorkerHostTenantSlot(): void {
  expect(injectedToken(WorkerHostService, 1)).toBe(TENANT_DRIZZLE);
}

export function assertWorkerHostFleetSlot(): void {
  expect(injectedToken(WorkerHostService, 2)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.11` — `RuleSweepService(db, alarmRaiser, notifications)`: the tenant
 * pool in slot 0, and no fleet token at all (`rule-sweep.service.ts` says
 * why: a second route to the fleet pool the processor mapping could not see).
 */
export function assertRuleSweepServiceTenantSlot(): void {
  expect(injectedToken(RuleSweepService, 0)).toBe(TENANT_DRIZZLE);
}

/** `F3.11` — `AlarmRaiser(db)`: the tenant pool, its only injection since the gateway left (ADR 0064 decision 4). */
export function assertAlarmRaiserTenantSlot(): void {
  expect(injectedToken(AlarmRaiser, 0)).toBe(TENANT_DRIZZLE);
}

/** `F3.11` — `AlarmNotifyService(fleetDb, gateway, metrics)`: the fleet pool in slot 0, for the read-by-id after `NOTIFY`. */
export function assertAlarmNotifyServiceFleetSlot(): void {
  expect(injectedToken(AlarmNotifyService, 0)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.3` — `AssetImagesService(tenantDb, fleetDb, client)` (ADR 0066 decision 6):
 * a conformed `withReadScope` reader, tenant first. Two claims, one function
 * each, as for `WorkerHostService`.
 */
export function assertAssetImagesServiceTenantSlot(): void {
  expect(injectedToken(AssetImagesService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertAssetImagesServiceFleetSlot(): void {
  expect(injectedToken(AssetImagesService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.4` — `AssetImagesWriteService(tenantDb, fleetDb, client, audit)` (ADR
 * 0066 Amendment 3, R-6): the insert runs under `withTenant` on slot 0 and
 * the asset's organization, the pre-checks and the actor lookup on slot 1.
 * A swap would insert on the BYPASSRLS pool, which `0072`'s `WITH CHECK`
 * could never refuse. Two claims, one function each.
 */
export function assertAssetImagesWriteServiceTenantSlot(): void {
  expect(injectedToken(AssetImagesWriteService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertAssetImagesWriteServiceFleetSlot(): void {
  expect(injectedToken(AssetImagesWriteService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.5a` — `ReportFilesService(tenantDb, fleetDb, client, config, reports,
 * accessControl, audit)` (ADR 0071 decisions 5, 6): the insert and the delete
 * run under `withTenant` on slot 0 and the saved organization; the cap
 * pre-check, the by-id read for the decision-6 verdict, the actor lookup and
 * the committed-row re-check on slot 1. A swap would insert on the BYPASSRLS
 * pool, which `0077`'s `WITH CHECK` could never refuse. Two claims, one
 * function each.
 */
export function assertReportFilesServiceTenantSlot(): void {
  expect(injectedToken(ReportFilesService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertReportFilesServiceFleetSlot(): void {
  expect(injectedToken(ReportFilesService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.5b` — `ReportRenderService(tenantDb, client, config, reports, email,
 * metrics, channels)`: the tenant pool in slot 0 and **no fleet token at
 * all** — the schedule read and the asset resolution run on the processor's
 * tenant transaction, and the render itself reaches the fleet pool only
 * through `ReportsService` (ADR 0071 decision 9). A fleet handle here would
 * be the second route the RLS scope could not see, the `RuleSweepService`
 * reasoning. The slot-1 `STORAGE_CLIENT` pin is the spec's structural
 * positive control (`report-render.service.spec.ts`).
 */
export function assertReportRenderServiceTenantSlot(): void {
  expect(injectedToken(ReportRenderService, 0)).toBe(TENANT_DRIZZLE);
}

/**
 * `F3.5b` U9 — `ReportDispatchService(client)`: the queue client in slot 0
 * and **no pool token at all** — the fleet handle is `tick(fleetDb)`'s
 * argument from the `fleet`-tenancy processor, the `RuleSweepService`
 * reasoning (a second `FLEET_DRIZZLE` route the processor mapping and
 * `worker-host.service.spec.ts` could not see). `WorkerHostService` appended
 * it in slot 6 and `ReportRenderService` in slot 7; the two slot-1/2 rows
 * above are re-run unchanged as the proof the append moved nothing.
 */
export function assertReportDispatchServiceInjectsTheQueueClient(): void {
  expect(injectedToken(ReportDispatchService, 0)).toBe(QUEUE_CLIENT);
}

/**
 * `F3.5b` U11 — `ReportSchedulesService(tenantDb, fleetDb, client,
 * accessControl, channels, audit)` (ADR 0071 decision 11; plan R-12): the
 * insert, the update and the row-then-object delete run under `withTenant`
 * on slot 0 and the schedule's organization — `0078`'s `WITH CHECK` refuses
 * a foreign stamp there; the location existence read, the by-id read for the
 * decision-6 verdict and the actor lookup on slot 1. A swap would insert on
 * the BYPASSRLS pool. Two claims, one function each.
 */
export function assertReportSchedulesServiceTenantSlot(): void {
  expect(injectedToken(ReportSchedulesService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertReportSchedulesServiceFleetSlot(): void {
  expect(injectedToken(ReportSchedulesService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F3.85` PR 5 — `CopilotPurgeService(tenantDb, fleetDb)` (ADR 0099
 * decision 8). Unlike `ReportDispatchService`, it injects both pools: the
 * fleet pool only lists `users.id` and `organizations.id` (0105 and 0106
 * revoke the copilot tables from `bms_fleet`), and every delete runs on slot
 * 0 inside `withUser` or (the organization counters, PR 6) `withTenant`. A
 * swap would run the deletes on the BYPASSRLS pool, where neither policy
 * binds anything. `WorkerHostService` appended the service in slot 8; the slot-1/2
 * rows above are re-run unchanged. Two claims, one function each.
 */
export function assertCopilotPurgeServiceTenantSlot(): void {
  expect(injectedToken(CopilotPurgeService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertCopilotPurgeServiceFleetSlot(): void {
  expect(injectedToken(CopilotPurgeService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `F4.297` (ADR 0108 decision 1.9) — `TelemetryService` reads the asset's
 * location and organization zones on the fleet pool in slot 2: `bms.assets` and
 * `bms.locations` are FORCE RLS and the service sets no `app.current_organization`,
 * so on the tenant pool the read sees no row and every asset reports `UTC` with
 * no error. `point-aggregate.integration.spec.ts` passes one pool in both slots,
 * so this is the only gate on the token. Slot 1 stays the tenant pool, for the
 * `telemetry.*` reads. Two claims, one function each.
 */
export function assertTelemetryServiceTenantPoolSlot(): void {
  expect(injectedToken(TelemetryService, 1)).toBe(TENANT_POOL);
}

export function assertTelemetryServiceFleetPoolSlot(): void {
  expect(injectedToken(TelemetryService, 2)).toBe(FLEET_POOL);
}

/**
 * `F4.359` — `MaintenanceWindowsService(tenantDb, fleetDb, audit)` (ADR 0131): every
 * write runs under `withTenant` on slot 0; the pre-tenant target and window reads,
 * the actor lookup and the list's fleet branch on slot 1. A swap would write on the
 * BYPASSRLS pool, which `0152`'s `WITH CHECK` could never refuse, and the
 * `.rls.integration` pair constructs the service with explicit pools. Two claims,
 * one function each.
 */
export function assertMaintenanceWindowsServiceTenantSlot(): void {
  expect(injectedToken(MaintenanceWindowsService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertMaintenanceWindowsServiceFleetSlot(): void {
  expect(injectedToken(MaintenanceWindowsService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `E1.4a` — `MlForecastsService(tenantDb, fleetDb)` (ADR 0135 Amendment 3 S4): both reads pass
 * slot 0 and slot 1 to `withReadScope` in that order. A swap would run a single-organization
 * caller's read on the BYPASSRLS pool, leaving the `asset_id = ANY(ids)` filter as its only
 * control, and the integration pair constructs the service with explicit pools, so only this
 * catches it. Two claims, one function each.
 */
export function assertMlForecastsServiceTenantSlot(): void {
  expect(injectedToken(MlForecastsService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertMlForecastsServiceFleetSlot(): void {
  expect(injectedToken(MlForecastsService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `E1.2b` — `MlAnomaliesService(tenantDb, fleetDb)` (ADR 0135 Amendment 5 A-e, Amendment 3 S4):
 * both reads pass slot 0 and slot 1 to `withReadScope` in that order, as the forecast service
 * does. A swap would run a single-organization caller's read on the BYPASSRLS pool. Two claims,
 * one function each.
 */
export function assertMlAnomaliesServiceTenantSlot(): void {
  expect(injectedToken(MlAnomaliesService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertMlAnomaliesServiceFleetSlot(): void {
  expect(injectedToken(MlAnomaliesService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `E1.9a` — `MlFindingsService(tenantDb, fleetDb)` (ADR 0135 Amendment 8 decision 10): both
 * summaries pass slot 0 and slot 1 to `withReadScope` in that order, as the forecast and anomaly
 * services do. A swap would run a single-organization caller's findings reads on the BYPASSRLS
 * pool. Two claims, one function each.
 */
export function assertMlFindingsServiceTenantSlot(): void {
  expect(injectedToken(MlFindingsService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertMlFindingsServiceFleetSlot(): void {
  expect(injectedToken(MlFindingsService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `E1.9c` — `FindingsParagraphService(tenantDb, findings, llm, availability)` (ADR 0135
 * Amendment 8 decision 7): every cache read and write runs in `withTenant` of the card's
 * organization on slot 0, and the service holds **no fleet token at all**. A fleet pool in
 * slot 0 would let a write land outside the card's organization with row security bypassed.
 */
export function assertFindingsParagraphServiceTenantSlot(): void {
  expect(injectedToken(FindingsParagraphService, 0)).toBe(TENANT_DRIZZLE);
  for (const slot of [1, 2, 3]) expect(injectedToken(FindingsParagraphService, slot)).toBeUndefined();
}

/**
 * `E2.3` — `AlarmRootCauseService(details, tenantDb)` (ADR 0136; plan Q2 as ruled): the
 * evidence reads run under `withTenant` on slot 1, and the service holds **no fleet token at
 * all** — its only fleet read is `AlarmDetailsService.get`, the gate. A fleet pool in slot 1
 * would leave the hand-written organization predicates as the only control, and the
 * integration suite constructs the service with explicit pools, so only this catches it.
 */
export function assertAlarmRootCauseServiceTenantSlot(): void {
  expect(injectedToken(AlarmRootCauseService, 1)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(AlarmRootCauseService, 0)).toBeUndefined();
}

/**
 * `E1.8a` — `HealthInputsService(tenantDb, fleetDb, health)` (ADR 0050 Amendment 5, plan T1.3):
 * every fact read passes slot 0 and slot 1 to `withReadScope` in that order. A swap would run a
 * single-organization caller's anomaly and ticket reads on the BYPASSRLS pool, and the
 * integration pair constructs the service with explicit pools, so only this catches it.
 */
export function assertHealthInputsServiceTenantSlot(): void {
  expect(injectedToken(HealthInputsService, 0)).toBe(TENANT_DRIZZLE);
}

export function assertHealthInputsServiceFleetSlot(): void {
  expect(injectedToken(HealthInputsService, 1)).toBe(FLEET_DRIZZLE);
}

/**
 * `E1.6a` — `AdvisoriesService(tenantDb, fleetDb, fleetPool, …)` (ADR 0137 decision 6, plan Q3):
 * the candidate read runs through `withReadScope(tenantDb, fleetDb, …)` on slots 0 and 1, and
 * the reused energy, register, pair and tariff reads run on the fleet pool in slot 2 with the
 * candidate ids only. Swapping slots 0 and 1 sends every single-organization read to `onEmpty`.
 */
export function assertAdvisoriesServiceSlots(): void {
  expect(injectedToken(AdvisoriesService, 0)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(AdvisoriesService, 1)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(AdvisoriesService, 2)).toBe(FLEET_POOL);
}

/**
 * `E1.5a` — `DegradationService(tenantDb, fleetDb, fleetPool, …)` (ADR 0138, plan T1.8, R-o):
 * the candidate, rule and schedule reads run through `withReadScope(tenantDb, fleetDb, …)` on
 * slots 0 and 1, and the counter and hourly-mean reads run on the fleet pool in slot 2 with the
 * considered ids only. Swapping slots 0 and 1 sends every single-organization read to `onEmpty`.
 */
export function assertDegradationServiceSlots(): void {
  expect(injectedToken(DegradationService, 0)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(DegradationService, 1)).toBe(FLEET_DRIZZLE);
  expect(injectedToken(DegradationService, 2)).toBe(FLEET_POOL);
}

/**
 * `F1.2` — `DeviceProfilesAdminService(tenantDb, fleetDb, …)` (ADR 0141 decision 13, plan T5.2):
 * every profile read and write runs under `withTenant` on slot 0; slot 1 maps a `:id` to its
 * organization before the tenant transaction opens. A swap would write on the BYPASSRLS pool,
 * which holds no INSERT on `bms.device_profiles` (migration `0164`), and the integration pair
 * constructs the service with explicit pools, so only this catches it.
 */
export function assertDeviceProfilesServiceSlots(): void {
  expect(injectedToken(DeviceProfilesAdminService, 0)).toBe(TENANT_DRIZZLE);
  expect(injectedToken(DeviceProfilesAdminService, 1)).toBe(FLEET_DRIZZLE);
}
