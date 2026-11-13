import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { type BmsDb, createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { MaintenanceWindowsService } from "../maintenance-windows/maintenance-windows.service";
import {
  buildWindowsFixture,
  dropWindowsGlobalActor,
  dropWindowsOrganization,
  type WindowsFixture,
} from "../maintenance-windows/maintenance-windows.service.rls.integration.spec";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aConfirmedCreateWritesTheWindowAndACopilotAuditRow,
  theTargetReadsAreTenantBound,
} from "./copilot-maintenance-window-targets.integration.spec";

/**
 * `F4.359` PR 6 — Vitest entry point for the Copilot's maintenance-window write and reads on the
 * real `bms_tenant` / `bms_fleet` pair, built as `maintenance-windows.service.rls.integration.test.ts`
 * builds it. Assertions live in the sibling `.spec` (ADR 0014).
 */
const connectionString = requireIntegrationDb({
  item: "F4.359",
  label: "the Copilot's maintenance-window audit mark and target reads",
  because:
    "a Copilot-confirmed window silences alarms; a green run here without a database would assert that its " +
    "audit row says it came from the Copilot and that the card's rows are read inside one organization while nothing checked it.",
});

describe.skipIf(!connectionString)("F4.359 PR 6 — the Copilot's maintenance windows on the real pools (ADR 0099 Amendment 19)", () => {
  let pools: pg.Pool[] = [];
  let admin: pg.Pool | undefined;
  const organizations: string[] = [];
  let fx: WindowsFixture | undefined;
  let tenantDb: BmsDb | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.359");
    const tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.359");
    const authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.359");
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.359");
    pools = [fleetPool, tenantPool, authPool, admin];
    tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const svc = new MaintenanceWindowsService(tenantDb, fleetDb, new MasterDataAuditService(tenantDb, fleetDb));
    const access = new AccessControlService(createDb(authPool), fleetDb);
    fx = await buildWindowsFixture(admin, svc, access, (id) => organizations.push(id));
  });

  afterAll(async () => {
    if (admin) for (const id of organizations) await dropWindowsOrganization(admin, id);
    if (admin && fx) await dropWindowsGlobalActor(admin, fx);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): WindowsFixture => fx ?? (() => { throw new Error("F4.359: the fixture was not built"); })();
  const tenant = (): BmsDb => tenantDb ?? (() => { throw new Error("F4.359: the tenant pool was not opened"); })();

  it("(1) a create confirmed through a Copilot change writes the window and an audit row with via: copilot", () =>
    aConfirmedCreateWritesTheWindowAndACopilotAuditRow(fixture()));
  it("(2) the target's reads are bound to one organization, count the covered assets and read a window's state", () =>
    theTargetReadsAreTenantBound(fixture(), tenant()));
});
