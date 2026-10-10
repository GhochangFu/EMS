import { BadRequestException } from "@nestjs/common";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { assetGroups, dashboardTabs, dashboardWidgets } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { TAB_GROUP_SCOPE_MESSAGE, TAB_ID_UNKNOWN_MESSAGE } from "@bms/shared";
import type { TabWriteBody } from "@bms/shared";
import type { TabRow, TabSyncDiff } from "./dashboards.pure";

/**
 * `F3.73` (plan D1, D2) — the `bms.dashboard_tabs` reads and writes of `DashboardsService`.
 *
 * A sibling module rather than more of `dashboards.service.ts`, which sat at 928 lines against the
 * §4.5 1000-line cap; `dashboard-point-scope.ts` and `dashboard-source-scope.ts` are the shape.
 * Every function takes the caller's open transaction and writes nothing on its own.
 */

/**
 * One dashboard's tabs, in strip order.
 *
 * **The `organization_id` predicate is the isolation control, not RLS.** `loadFullDto` runs on a
 * `fleetDb` transaction when `getBySlug` takes the multi-organization branch, and `bms_fleet`
 * holds BYPASSRLS. Nothing in the schema ties a tab's `organization_id` to its dashboard's, so a
 * mis-stamped row of another organization is writable, and only this predicate keeps it out of
 * the DTO. `dashboards.service.tabs.integration.spec.ts` writes exactly that row and reads it
 * back through the fleet branch.
 */
export async function readDashboardTabs(tx: BmsTx, dashboardId: string, organizationId: string): Promise<TabRow[]> {
  return tx
    .select()
    .from(dashboardTabs)
    .where(and(eq(dashboardTabs.dashboardId, dashboardId), eq(dashboardTabs.organizationId, organizationId)))
    .orderBy(asc(dashboardTabs.sortOrder), asc(dashboardTabs.tabKey));
}

/** Every body tab `id` must be one of this dashboard's stored tabs. The id is never echoed, so
 * the 400 does not confirm that another dashboard's tab exists. */
export function assertTabIdsStored(stored: readonly TabRow[], tabs: readonly TabWriteBody[]): void {
  const storedIds = new Set(stored.map((tab) => tab.id));
  if (tabs.some((tab) => tab.id !== undefined && !storedIds.has(tab.id))) {
    throw new BadRequestException(TAB_ID_UNKNOWN_MESSAGE);
  }
}

/**
 * Every group a tab names must be a group of this organization AT the dashboard's site.
 *
 * The composite foreign key `dashboard_tabs_asset_group_id_location_id_fkey` and the policy's
 * group leg are the backstop; this is the answer an author reads. The explicit organization and
 * location predicates make the check whatever the handle, and a group of another site, another
 * organization, or no group at all answer the same sentence.
 *
 * **`FOR KEY SHARE` holds each named group until the save commits**, the
 * `assertMimicLayoutsInOrganization` precedent: a concurrent delete of the group waits for this
 * save, then meets the `ON DELETE RESTRICT` of the tab it wrote.
 */
export async function assertTabGroupsAtSite(
  tx: BmsTx,
  organizationId: string,
  locationId: string | null,
  tabs: readonly TabWriteBody[],
): Promise<void> {
  const groupIds = [...new Set(tabs.flatMap((tab) => (tab.assetGroupId ? [tab.assetGroupId] : [])))];
  if (groupIds.length === 0) {
    return;
  }
  if (locationId === null) {
    throw new BadRequestException(TAB_GROUP_SCOPE_MESSAGE);
  }
  const rows = await tx
    .select({ id: assetGroups.id })
    .from(assetGroups)
    .where(
      and(
        inArray(assetGroups.id, groupIds),
        eq(assetGroups.organizationId, organizationId),
        eq(assetGroups.locationId, locationId),
      ),
    )
    .for("key share");
  if (rows.length !== groupIds.length) {
    throw new BadRequestException(TAB_GROUP_SCOPE_MESSAGE);
  }
}

/**
 * Writes the tab diff and returns every body tab's key -> id, new tabs included.
 *
 * **The order is load-bearing.** A kept widget may sit on a tab this request deletes, and the
 * widgets' foreign key to the tab is `ON DELETE CASCADE`: deleting the tab first would delete the
 * widget the body keeps, and its later UPDATE would touch no row. So the kept widgets on a doomed
 * tab are detached first (their UPDATE puts them on their new tab afterwards). Deletes then run
 * before inserts, so a new tab may reuse a deleted tab's key without meeting
 * `dashboard_tabs_dashboard_id_tab_key_key`.
 *
 * **A renamed tab passes through a placeholder key** (`t-<its id>`, which the key CHECK
 * accepts), because the key UNIQUE is not deferrable: two kept tabs swapping keys would
 * otherwise collide on the first UPDATE and answer a 500.
 *
 * `location_id` is the dashboard's for a group tab and NULL for an Overview tab — the
 * `dashboard_tabs_group_location_check` rule, stamped here and never taken from the body.
 */
export async function writeDashboardTabs(
  tx: BmsTx,
  target: { organizationId: string; dashboardId: string; locationId: string | null },
  stored: readonly TabRow[],
  diff: TabSyncDiff,
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  // Every tab write is bounded by this dashboard as well as by id: the ids come from a read, and
  // a read that lost its dashboard predicate must not turn into a write on another dashboard.
  const onThisDashboard = (tabId: SQL) => and(eq(dashboardTabs.dashboardId, target.dashboardId), tabId);
  const locationFor = (tab: TabWriteBody): string | null => (tab.assetGroupId ? target.locationId : null);

  if (diff.deleteIds.length > 0) {
    const doomed = [...diff.deleteIds];
    await tx
      .update(dashboardWidgets)
      .set({ tabId: null })
      .where(and(eq(dashboardWidgets.dashboardId, target.dashboardId), inArray(dashboardWidgets.tabId, doomed)));
    await tx.delete(dashboardTabs).where(onThisDashboard(inArray(dashboardTabs.id, doomed)));
  }

  const storedKey = new Map(stored.map((tab) => [tab.id, tab.tabKey]));
  for (const tab of diff.updates) {
    if (storedKey.get(tab.id) !== tab.key) {
      await tx
        .update(dashboardTabs)
        .set({ tabKey: `t-${tab.id}` })
        .where(onThisDashboard(eq(dashboardTabs.id, tab.id)));
    }
  }
  for (const tab of diff.updates) {
    await tx
      .update(dashboardTabs)
      .set({
        tabKey: tab.key,
        label: tab.label,
        sortOrder: tab.sortOrder,
        assetGroupId: tab.assetGroupId ?? null,
        locationId: locationFor(tab),
        updatedAt: new Date(),
      })
      .where(onThisDashboard(eq(dashboardTabs.id, tab.id)));
    idByKey.set(tab.key, tab.id);
  }

  for (const tab of stored) {
    if (diff.unchangedIds.includes(tab.id)) {
      idByKey.set(tab.tabKey, tab.id);
    }
  }

  for (const tab of diff.inserts) {
    const [row] = await tx
      .insert(dashboardTabs)
      .values({
        organizationId: target.organizationId,
        dashboardId: target.dashboardId,
        tabKey: tab.key,
        label: tab.label,
        sortOrder: tab.sortOrder,
        assetGroupId: tab.assetGroupId ?? null,
        locationId: locationFor(tab),
      })
      .returning({ id: dashboardTabs.id });
    idByKey.set(tab.key, row.id);
  }
  return idByKey;
}
