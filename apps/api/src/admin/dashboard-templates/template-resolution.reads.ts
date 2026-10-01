import { and, asc, eq } from "drizzle-orm";

import { assetGroupMembers, assetPoints, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { GroupMember } from "@bms/shared";

/**
 * The two reads a template's role bindings resolve against — `F3.36` (ADR 0049 decision 4,
 * Amendment 2), moved out of `DashboardTemplatesInstantiateService` by `F3.73` (plan Task 4.2) so
 * the group arm and the site-layout copy action (`SiteLayoutService`) read members and points
 * the same way. Byte-for-byte the queries the instantiate service ran, comments included.
 *
 * Each takes the executor: the instantiate service passes `fleetDb`, the copy action its open
 * tenant transaction (a group it made in that transaction is not visible to another pool).
 */
export type TemplateResolutionDb = Pick<BmsDb, "select">;

/**
 * Members of one group, grouped by role and **ordered by `assets.code`**.
 *
 * The order is the whole reason "the first match" is an answer rather than a
 * coin toss: `assets.code` is `NOT NULL UNIQUE`, so it is a total order.
 * Members with no role are skipped — a membership with a NULL role plays no
 * named part and no template widget can name it.
 */
export async function loadMembersByRole(
  db: TemplateResolutionDb,
  assetGroupId: string,
  organizationId: string,
): Promise<Map<string, GroupMember[]>> {
  const rows = await db
    .select({ role: assetGroupMembers.role, assetId: assets.id, code: assets.code })
    .from(assetGroupMembers)
    .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
    // `bms_fleet` holds `BYPASSRLS`, so this predicate is the ONLY isolation
    // control on this read — `dashboard-point-scope.ts` states the rule and
    // calls a foreign `assetId` leaving the module "a cross-tenant telemetry
    // read waiting to happen". The organization filter was missing: a foreign
    // member yielded no binding only because `loadActivePoints` filters, which
    // makes containment transitive on a predicate one file away. Added by the
    // `F3.36` security review.
    .where(
      and(
        eq(assetGroupMembers.assetGroupId, assetGroupId),
        eq(assets.organizationId, organizationId),
      ),
    )
    .orderBy(asc(assets.code));

  const byRole = new Map<string, GroupMember[]>();
  for (const row of rows) {
    if (!row.role) continue;
    const list = byRole.get(row.role) ?? [];
    // The CODE is carried, not only the id. It used to be selected and then
    // discarded, and the field that survived was named `assetCode` while
    // holding a uuid — so the next reader who sorted on it would have sorted
    // by uuid and silently lost Amendment 2 decision 2's tie-break. Found by
    // the `F3.36` correctness review.
    list.push({ assetId: row.assetId, code: row.code });
    byRole.set(row.role, list);
  }
  return byRole;
}

/** Active points, keyed `assetId::pointKey`. Inactive points are skipped:
 * binding a retired sensor is the shortfall `partial` exists to report. */
export async function loadActivePoints(
  db: TemplateResolutionDb,
  organizationId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: assetPoints.id, assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
    .from(assetPoints)
    .where(and(eq(assetPoints.organizationId, organizationId), eq(assetPoints.active, true)));

  const byKey = new Map<string, string>();
  for (const row of rows) {
    byKey.set(`${row.assetId}::${row.pointKey}`, row.id);
  }
  return byKey;
}
