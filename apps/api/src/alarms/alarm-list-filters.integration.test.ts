import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertSeverityAndRangeIntersect,
  assertSeverityKeepsThatCodeOnly,
  assertTheCursorPagesInsideTheFilter,
  assertTheRaisedRangeIsHalfOpen,
  buildAlarmListFiltersFixture,
  dropOrganization,
  type AlarmListFiltersFixture,
} from "./alarm-list-filters.integration.spec";
import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

/**
 * `F4.291` PR 2 — Vitest entry point for `AlarmsService.list`'s severity and
 * raised-range filters. Assertions live in the sibling `.spec` (ADR 0014).
 * The service runs on the real `bms_tenant` / `bms_fleet` pair, as
 * `alarms.service.rls.integration.test.ts` builds it; the fixture is written
 * as the superuser in a fresh organization and deleted by its id.
 */
const connectionString = requireIntegrationDb({
  item: "F4.291",
  label: "AlarmsService.list severity and raised-range filters",
  because:
    "the copilot's list_alarms answers 'alarms of this severity over this period' through these filters; " +
    "a green run here without a database would assert that the range is half-open and the cursor pages " +
    "inside the filter while nothing checked it.",
});

const gatewayStub = { broadcastAcknowledged: () => undefined } as unknown as AlarmsGateway;

describe.skipIf(!connectionString)("F4.291 — AlarmsService.list filters by severity and a raised range", () => {
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  let pools: pg.Pool[] = [];
  let admin: pg.Pool | undefined;
  let fx: AlarmListFiltersFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.291");
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.291",
    );
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.291");
    pools = [fleetPool, tenantPool, admin];
    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const svc = new AlarmsService(tenantDb, fleetDb, gatewayStub, new MasterDataAuditService(tenantDb, fleetDb));
    fx = await buildAlarmListFiltersFixture(admin, run, svc);
  });

  afterAll(async () => {
    if (admin && fx) await dropOrganization(admin, fx.organizationId);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): AlarmListFiltersFixture => fx ?? (() => { throw new Error("F4.291: the fixture was not built"); })();

  it("severity keeps the alarms of that code only", () => assertSeverityKeepsThatCodeOnly(fixture()));
  it("raisedFrom is inclusive and raisedTo exclusive", () => assertTheRaisedRangeIsHalfOpen(fixture()));
  it("severity and the raised range together are their intersection", () => assertSeverityAndRangeIntersect(fixture()));
  it("the keyset cursor pages inside the filtered set", () => assertTheCursorPagesInsideTheFilter(fixture()));
});
