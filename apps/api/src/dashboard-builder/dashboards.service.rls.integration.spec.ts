import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { CountingDb, CountingDbMethod } from "../testing/counting-db";
import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.1b` Task 4 — RLS-backed proof of what `DashboardsService` actually does with a REAL
 * connection. Assertions live here; `dashboards.service.rls.integration.test.ts` is the
 * Vitest entry point (ADR 0014) and owns the database lifecycle.
 */

/**
 * **Pool routing on create.** `countingDb(tenantDb).transactions() === 1`: the write AND its
 * folded read-back both run inside the one `withTenant` transaction `create()` opens — see
 * that method's own comment for why the read-back is folded rather than a second
 * `withTenant`. `countingDbMethod(fleetDb, "insert").calls() === 0`: nothing about a
 * tenant-scoped create touches the fleet pool's `.insert` (E7.1c's own generalisation of
 * `countingDb`, since `fetchRowForWrite` on other routes uses a plain `.select`, never
 * `.insert`, on `fleetDb`).
 */
export async function assertCreateRoutesOnTenantPoolOnly(
  service: DashboardsService,
  countedTenant: CountingDb,
  countedFleetInsert: CountingDbMethod,
  actor: JwtPayload,
  organizationId: string,
  slug: string,
): Promise<{ id: string }> {
  const tenantBefore = countedTenant.transactions();
  const fleetInsertBefore = countedFleetInsert.calls();

  const dto = await service.create(actor, {
    organizationId,
    slug,
    name: "F3.1b RLS proof",
  } as Parameters<DashboardsService["create"]>[1]);

  expect(countedTenant.transactions(), "create() must open exactly one tenant transaction").toBe(
    tenantBefore + 1,
  );
  expect(
    countedFleetInsert.calls(),
    "create() must never .insert on the fleet pool",
  ).toBe(fleetInsertBefore);
  expect(dto.id).toBeTruthy();
  expect(dto.slug).toBe(slug);
  expect(dto.organizationId).toBe(organizationId);
  // createdAt === updatedAt on a freshly created row — the FIRST half of "the DTO reflects
  // the write", proven without a transaction count.
  expect(dto.updatedAt).toBe(dto.createdAt);

  return { id: dto.id };
}

/**
 * The audit row, read back on a SEPARATE fleet connection — proving the write COMMITTED
 * rather than merely being issued inside a transaction this test also opened.
 */
export async function assertCreateAuditRowStamped(
  fleetDb: BmsDb,
  dashboardId: string,
  organizationId: string,
): Promise<void> {
  const rows = await fleetDb.execute(
    sql`SELECT organization_id, action FROM bms.audit_log
         WHERE entity_type = 'dashboard' AND entity_id = ${dashboardId}
           AND action = 'master.dashboard.create'`,
  );
  const row = rows.rows[0] as { organization_id: string | null; action: string } | undefined;
  expect(row, "no audit_log row for this create — the write did not commit or was not audited").toBeDefined();
  expect(row?.organization_id, "the audit row's organization_id must be stamped, never NULL").toBe(
    organizationId,
  );
  expect(row?.action).toBe("master.dashboard.create");
}

/**
 * **The read-back is gated by BEHAVIOUR, not a transaction count.** `countingDb` intercepts
 * only top-level `.transaction`, so a folded read-back inside `putWidgets`'s one `withTenant`
 * is invisible to it — a "one transaction" assertion would pass whether the read-back is
 * folded, separate, or silently dropped. Gate instead on the RETURNED DTO reflecting the
 * write, checked against a SEPARATE fleet-connection read of the same rows — new widget
 * count, and `updatedAt` strictly later than before the call. Same blindness
 * `maintenance.service.rls.integration.spec.ts:336` already records from the write side.
 */
export async function assertPutWidgetsDtoReflectsTheWrite(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  dashboardId: string,
  pointId: string,
): Promise<void> {
  const before = await service.getBySlug(actor, await slugFor(fleetDb, dashboardId));
  expect(before.widgets.length, "fixture must start with zero widgets").toBe(0);

  const after = await service.putWidgets(actor, dashboardId, {
    widgets: [
      {
        widgetType: "value_tile",
        title: "Total kW",
        gridX: 0,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        config: {},
        points: [{ pointId }],
      },
    ],
  } as Parameters<DashboardsService["putWidgets"]>[2]);

  expect(after.widgets.length, "the returned DTO must show the new widget count").toBe(1);
  expect(
    new Date(after.updatedAt).getTime(),
    "updatedAt must move forward — the DTO must reflect the write it just made",
  ).toBeGreaterThan(new Date(before.updatedAt).getTime());

  const onFleet = await fleetDb.execute(
    sql`SELECT COUNT(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = ${dashboardId}`,
  );
  expect(
    (onFleet.rows[0] as { n: number }).n,
    "a separate fleet-connection read must also see exactly one widget row — proves the write committed",
  ).toBe(1);
}

async function slugFor(fleetDb: BmsDb, dashboardId: string): Promise<string> {
  const rows = await fleetDb.execute(sql`SELECT slug FROM bms.dashboards WHERE id = ${dashboardId}`);
  return (rows.rows[0] as { slug: string }).slug;
}

/**
 * Cross-tenant read: an ESKOM-scoped caller reading a PHEWB dashboard by its own slug (which
 * happens to collide with nothing in ESKOM) gets a 404 — not a row, and not a 403 that would
 * disclose it exists in another organization.
 */
export async function assertCrossTenantSlugReadIs404(
  service: DashboardsService,
  eskomScopedActor: JwtPayload,
  phewbSlug: string,
): Promise<void> {
  await expect(service.getBySlug(eskomScopedActor, phewbSlug)).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * Cross-tenant write, id-addressed: an ESKOM `admin` targeting a PHEWB dashboard's id through
 * `update()` gets the SAME 404 a nonexistent id would — `rules.service.ts:753-757`'s
 * cross-tenant-existence-oracle precedent. `fetchRowForWrite` runs on `fleetDb` (BYPASSRLS) and
 * WOULD find the row; `canManageDashboard` is what refuses it, and the refusal is folded into
 * the same 404 as "no such id" rather than surfaced as a distinguishable 403.
 */
export async function assertForeignOrgIdUpdateIs404SameAsNonexistent(
  service: DashboardsService,
  eskomOrgAdmin: JwtPayload,
  phewbDashboardId: string,
): Promise<void> {
  const nonexistentId = "00000000-0000-4000-8000-0000000000ff";

  let foreignMessage: unknown;
  try {
    await service.update(eskomOrgAdmin, phewbDashboardId, { name: "should not land" });
  } catch (err) {
    foreignMessage = (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }
  let nonexistentMessage: unknown;
  try {
    await service.update(eskomOrgAdmin, nonexistentId, { name: "should not land" });
  } catch (err) {
    nonexistentMessage = (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }

  expect(foreignMessage, "a foreign-org dashboard id must be refused").toBeDefined();
  expect(
    foreignMessage,
    "a foreign-org id and a nonexistent id must produce the SAME body — otherwise the error " +
      "is a cross-tenant existence oracle",
  ).toEqual(nonexistentMessage);
}

/**
 * Cross-tenant write, scope: creating an ESKOM-stamped dashboard scoped to a PHEWB
 * `location_id` is refused by `tenant_isolation`'s `WITH CHECK` — `0050`'s header records that
 * `WITH CHECK` runs before the foreign key's `AFTER` trigger, so this is an RLS refusal, not
 * `dashboards_location_id_fkey`. Assert the message names row-level security, and does NOT
 * name the constraint.
 */
export async function assertCrossOrgLocationScopeRefusedByRls(
  service: DashboardsService,
  eskomAdmin: JwtPayload,
  eskomOrgId: string,
  phewbLocationId: string,
  slug: string,
): Promise<void> {
  let caught: unknown;
  try {
    await service.create(eskomAdmin, {
      organizationId: eskomOrgId,
      slug,
      name: "F3.1b cross-org scope proof",
      locationId: phewbLocationId,
    } as Parameters<DashboardsService["create"]>[1]);
  } catch (err) {
    caught = err;
  }

  expect(caught, "an ESKOM dashboard scoped to a PHEWB location must be refused").toBeDefined();
  const message = String((caught as Error)?.message ?? caught);
  expect(
    message,
    `expected a row-level-security refusal, got: ${message}`,
  ).toMatch(/row-level security|policy/i);
  expect(
    message,
    "must NOT name the foreign key — 0050's header records WITH CHECK runs before the FK's AFTER trigger",
  ).not.toMatch(/dashboards_location_id_fkey/i);
}
