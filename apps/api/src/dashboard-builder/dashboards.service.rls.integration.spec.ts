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

/**
 * **Finding 1 (review, HIGH) — the fleet-branch negative.** `assertCrossTenantSlugReadIs404`-
 * style tests that use a SINGLE-organization actor exercise only the TENANT branch, where the
 * `0047` `FORCE` RLS policy masks a missing caller-side filter — which is exactly how the
 * original `readableAssetIds`-routed implementation shipped with a cross-tenant read leak that
 * every earlier test passed. This is the test that only fails if `withOrganizationReadScope`'s
 * fleet branch is missing its `inArray(dashboards.organizationId, organizationIdFilter)`
 * filter: a genuinely two-organization caller (ADR 0043 decision 3's documented fallback —
 * `organization_admin` with two `user_organization_access` rows) must see only ITS OWN two
 * organizations' dashboards, never a third, unrelated organization's — not as a row in
 * `list()`, and not even as the ambiguity-disclosing 400 `getBySlug` used to be capable of.
 */
export async function assertFleetBranchExcludesAForeignOrganization(
  service: DashboardsService,
  twoOrgActor: JwtPayload,
  ownOrgIds: readonly string[],
  foreignOrgDashboard: { readonly id: string; readonly slug: string },
): Promise<void> {
  const listed = await service.list(twoOrgActor);
  expect(
    listed.items.some((item) => item.id === foreignOrgDashboard.id),
    "a two-organization caller's list() must not include a third organization's dashboard",
  ).toBe(false);
  for (const item of listed.items) {
    expect(
      ownOrgIds.includes(item.organizationId),
      `list() returned a dashboard (${item.id}, org ${item.organizationId}) outside the ` +
        "caller's own two organizations — the fleet-branch leak this test exists to catch",
    ).toBe(true);
  }

  await expect(service.getBySlug(twoOrgActor, foreignOrgDashboard.slug)).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * **Finding 5 (review) — the test commit `15a1ab9`'s `update()` reorder shipped without.**
 * `dashboards.service.rls.integration.spec.ts`'s existing update() calls all send `{name}`
 * only, so the "both scope columns set" 400 branch was never reached and reverting the reorder
 * left the whole suite green. This targets a dashboard whose STORED scope already carries
 * `assetGroupId`, PATCHes only `locationId`, and — with an actor `canManageDashboard` refuses
 * for this row — asserts the SAME 404 a nonexistent id gets. Before the reorder, the
 * "both set" 400 ran first and would have disclosed both that the row exists and that its
 * stored scope is an asset group, to a caller with no authority over it.
 */
export async function assertUnauthorizedUpdateWithScopeConflictIs404(
  service: DashboardsService,
  unauthorizedActor: JwtPayload,
  dashboardIdWithStoredAssetGroupId: string,
  anyLocationId: string,
): Promise<void> {
  const nonexistentId = "00000000-0000-4000-8000-0000000000ff";

  let scopedConflictMessage: unknown;
  try {
    await service.update(unauthorizedActor, dashboardIdWithStoredAssetGroupId, {
      locationId: anyLocationId,
    });
  } catch (err) {
    scopedConflictMessage =
      (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }
  let nonexistentMessage: unknown;
  try {
    await service.update(unauthorizedActor, nonexistentId, { locationId: anyLocationId });
  } catch (err) {
    nonexistentMessage =
      (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }

  expect(
    scopedConflictMessage,
    "an unauthorized caller PATCHing a dashboard whose merge would violate the scope invariant must still be refused",
  ).toBeDefined();
  expect(
    scopedConflictMessage,
    "must be the SAME 404 as a nonexistent id — a distinguishable 400 here would disclose the " +
      "row exists, and that its stored scope is an asset group, before this caller has any " +
      "authority to know either",
  ).toEqual(nonexistentMessage);
}
