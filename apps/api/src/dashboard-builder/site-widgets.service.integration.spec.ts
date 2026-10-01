import { randomUUID } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, SiteWidgetsResponse, SiteWidgetTab } from "@bms/shared";

import { AssetRoleSummaryService } from "../assets/asset-role-summary.service";
import type { AccessControlService } from "../auth/access-control.service";
import { withRollback } from "../testing/with-rollback";
import { SiteWidgetsService } from "./site-widgets.service";

/**
 * `F3.73` (plan D9, Task 3.4) — `SiteWidgetsService` against a real database. The sibling
 * `.integration.test.ts` owns the pool; the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * **Every case runs inside `withRollback` and calls `tx.rollback()`** (the `F3.60` rule). The
 * service and the role summary are built over that one Drizzle transaction, so their own
 * `.transaction()` calls nest as savepoints and nothing commits.
 *
 * **The site.** A fresh organization and site; group A holds `a1` (one live sample), group B
 * holds `b1` (one active `critical` alarm) and `b2` (one active `warning`); neither B member has
 * a sample. The dashboard sits at the site with three tabs — `overview` (no group), `a` (group
 * A), `b` (group B) — plus `stamped`: a tab on THIS dashboard whose `organization_id` is a
 * second organization's. Nothing ties a tab's organization to its dashboard's, so the row is
 * writable, and the read must not see it. The read runs under `withTenant` now, and S9 still
 * holds the explicit predicate: measured, dropping `dashboard_tabs.organization_id` from the tab
 * lookup turns S9b red on this connection even with the organization set.
 *
 * **Needs migrations `0094` (tabs) and `0087` (the `wtp` role).**
 */

type Tx = Parameters<Parameters<BmsDb["transaction"]>[0]>[0];

interface Site {
  readonly organizationId: string;
  readonly foreignOrganizationId: string;
  readonly locationId: string;
  readonly dashboardId: string;
  readonly a1: string;
  readonly b1: string;
  readonly b2: string;
  readonly stampedTabId: string;
  readonly groupA: string;
  readonly groupB: string;
  readonly txDb: BmsDb;
}

async function one<T>(tx: Tx, query: ReturnType<typeof sql>, what: string): Promise<T> {
  const result = await tx.execute<T & Record<string, unknown>>(query);
  const row = result.rows[0];
  if (!row) throw new Error(`F3.73 site-widgets fixture: failed to insert ${what}`);
  return row as T;
}

async function seedOrganization(tx: Tx, tag: string): Promise<{ organizationId: string; locationId: string }> {
  const org = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.organizations (code, name, currency) VALUES (${`${tag}-ORG`}, 'F3.73 site-widgets org', 'ZAR') RETURNING id`,
    "an organization",
  );
  const loc = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
        VALUES (${org.id}, ${`${tag}-LOC`}, ${tag.toLowerCase()}, 'F3.73 site-widgets site', 'rsmoc', 0, 0, true)
        RETURNING id`,
    "a location",
  );
  return { organizationId: org.id, locationId: loc.id };
}

async function seedSite(tx: Tx): Promise<Site> {
  const tag = `F373SW-${randomUUID().slice(0, 8)}`;
  const own = await seedOrganization(tx, tag);
  const foreign = await seedOrganization(tx, `${tag}-X`);
  const domain = await one<{ code: string }>(
    tx,
    sql`SELECT code FROM bms.asset_domains ORDER BY sort_order, code LIMIT 1`,
    "a domain lookup (bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed)",
  );
  const group = async (suffix: string): Promise<string> =>
    (
      await one<{ id: string }>(
        tx,
        sql`INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
            VALUES (${own.locationId}, ${`${tag}-${suffix}`.toLowerCase()}, ${`F3.73 group ${suffix}`}, NULL, ${own.organizationId})
            RETURNING id`,
        `group ${suffix}`,
      )
    ).id;
  const asset = async (code: string, groupId: string): Promise<string> => {
    const row = await one<{ id: string }>(
      tx,
      sql`INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
          VALUES (${own.organizationId}, ${`${tag}-${code}`}, ${`F3.73 ${code}`}, ${`${tag} site`}, ${own.locationId}, ${domain.code})
          RETURNING id`,
      `asset ${code}`,
    );
    await tx.execute(
      sql`INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES (${groupId}, ${row.id}, 'wtp')`,
    );
    return row.id;
  };
  const groupA = await group("A");
  const groupB = await group("B");
  const a1 = await asset("A1", groupA);
  const b1 = await asset("B1", groupB);
  const b2 = await asset("B2", groupB);

  await tx.execute(sql`
    INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at) VALUES
      (${own.organizationId}, ${b1}, 'critical', 'F3.73 b1 critical', now() - interval '1 minute', NULL),
      (${own.organizationId}, ${b2}, 'warning', 'F3.73 b2 warning', now() - interval '2 minutes', NULL),
      (${own.organizationId}, ${a1}, 'critical', 'F3.73 a1 cleared critical', now() - interval '3 minutes', now())
  `);
  await tx.execute(
    sql`INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES (now() - make_interval(secs => 1), ${a1}, 'kw', 1)`,
  );

  const dashboard = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
        VALUES (${own.organizationId}, ${`${tag}-site`.toLowerCase()}, 'F3.73 site-widgets fixture', ${own.locationId})
        RETURNING id`,
    "the site dashboard",
  );
  const tab = async (key: string, groupId: string | null, sortOrder: number, stamp: string): Promise<string> =>
    (
      await one<{ id: string }>(
        tx,
        sql`INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
            VALUES (${stamp}, ${dashboard.id}, ${groupId === null ? null : own.locationId}, ${groupId}, ${key}, ${`Tab ${key}`}, ${sortOrder})
            RETURNING id`,
        `tab ${key}`,
      )
    ).id;
  await tab("overview", null, 0, own.organizationId);
  await tab("a", groupA, 1, own.organizationId);
  await tab("b", groupB, 2, own.organizationId);
  const stampedTabId = await tab("stamped", groupA, 3, foreign.organizationId);

  return {
    organizationId: own.organizationId,
    foreignOrganizationId: foreign.organizationId,
    locationId: own.locationId,
    dashboardId: dashboard.id,
    a1,
    b1,
    b2,
    stampedTabId,
    groupA,
    groupB,
    txDb: tx as unknown as BmsDb,
  };
}

function serviceOver(
  site: Site,
  accessControl: Partial<AccessControlService> = {},
  fleetDb: BmsDb = site.txDb,
): SiteWidgetsService {
  return new SiteWidgetsService(
    fleetDb,
    site.txDb,
    accessControl as AccessControlService,
    new AssetRoleSummaryService(site.txDb, site.txDb),
  );
}

/** An unrestricted read (`readableAssetIds = null`) of one tab. */
async function readAs(
  site: Site,
  tabKey: string | null,
  readable: readonly string[] | null = null,
  service: SiteWidgetsService = serviceOver(site),
): Promise<SiteWidgetsResponse> {
  return service.read(
    {
      id: site.dashboardId,
      organizationId: site.organizationId,
      locationId: site.locationId,
      assetGroupId: null,
      assetId: null,
    },
    tabKey,
    readable,
    readable === null ? null : { locationIds: [site.locationId] },
    Date.now(),
  );
}

function tabNamed(dto: SiteWidgetsResponse, key: string): SiteWidgetTab {
  const found = dto.tabs.find((tab) => tab.tabKey === key);
  if (found === undefined) throw new Error(`no tab ${key} in ${JSON.stringify(dto.tabs.map((t) => t.tabKey))}`);
  return found;
}

async function inSite(check: (site: Site) => Promise<void>, db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await check(await seedSite(tx));
    tx.rollback();
  });
}

/** S1 — tab B's member `b1` holds an active critical alarm: B's worst severity is critical. */
export async function assertTabWithCriticalMemberIsCritical(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect(tabNamed(await readAs(site, null), "b").status?.worstSeverity).toBe("critical");
  }, db);
}

/** S2a — tab A (only a cleared alarm) still has a status: it is readable and has a member. */
export async function assertQuietTabHasAStatus(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect(tabNamed(await readAs(site, null), "a").status).not.toBeNull();
  }, db);
}

/** S2b — tab A's only alarm is cleared: no worst severity, tone `ok`. */
export async function assertQuietTabHasNoWorstSeverity(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const status = tabNamed(await readAs(site, null), "a").status;
    expect({ worstSeverity: status?.worstSeverity, tone: status?.tone }).toEqual({ worstSeverity: null, tone: "ok" });
  }, db);
}

/** S3 — offline counts come from the shared live window: `a1` is live, `b1` and `b2` are not. */
export async function assertOfflineCountsFollowTheLiveWindow(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, null);
    expect({
      a: tabNamed(dto, "a").status?.offlineAssets,
      b: tabNamed(dto, "b").status?.offlineAssets,
      bAlarms: tabNamed(dto, "b").status?.activeAlarms,
    }).toEqual({ a: 0, b: 2, bAlarms: 2 });
  }, db);
}

/** S4a — positive control: an unrestricted reader counts both B members. */
export async function assertUnrestrictedReaderCountsBothMembers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect(tabNamed(await readAs(site, null), "b").status?.assets).toBe(2);
  }, db);
}

/** S4b — `b2` is outside the caller's readable set: it is not counted, nor its warning. */
export async function assertUnreadableMemberIsNotCounted(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const status = tabNamed(await readAs(site, null, [site.a1, site.b1]), "b").status;
    expect({ assets: status?.assets, activeAlarms: status?.activeAlarms, offline: status?.offlineAssets }).toEqual({
      assets: 1,
      activeAlarms: 1,
      offline: 1,
    });
  }, db);
}

/** S4c — no B member readable: B answers `status: null` ("Outside scope"), never zeros. */
export async function assertTabWithNoReadableMemberIsOutsideScope(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect(tabNamed(await readAs(site, null, [site.a1]), "b").status).toBeNull();
  }, db);
}

/** S5 — `roles` on a group tab is the tab group's role summary, not the empty answer. */
export async function assertGroupTabRolesAreNonEmpty(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const roles = (await readAs(site, "b")).roles;
    expect(roles.map((role) => ({ code: role.code, count: role.count }))).toEqual([{ code: "wtp", count: 2 }]);
  }, db);
}

/** S6 — a group tab's scope, rail and summary are its group's members only. */
export async function assertGroupTabScopesTheRail(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, "b");
    expect({
      tabKey: dto.tabKey,
      assetCount: dto.scope.assetCount,
      rail: dto.alarms.active.map((alarm) => alarm.assetId),
      critical: dto.alarms.summary.find((row) => row.code === "critical")?.count,
    }).toEqual({ tabKey: "b", assetCount: 2, rail: [site.b1, site.b2], critical: 1 });
  }, db);
}

/** S7 — the Overview reads the dashboard's site: all three assets. */
export async function assertOverviewReadsTheSite(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, "overview")).scope.assetCount).toBe(3);
  }, db);
}

/** S8 — an unknown `tab` is a 404. */
export async function assertUnknownTabIsNotFound(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await expect(readAs(site, "nope")).rejects.toBeInstanceOf(NotFoundException);
  }, db);
}

/** S9a — control: the foreign-stamped tab row exists on this dashboard. */
export async function assertStampedTabRowExists(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const result = await site.txDb.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM bms.dashboard_tabs
          WHERE id = ${site.stampedTabId} AND dashboard_id = ${site.dashboardId} AND organization_id = ${site.foreignOrganizationId}`,
    );
    expect(result.rows[0]?.n).toBe(1);
  }, db);
}

/** S9b — `?tab=` never finds a tab stamped with another organization. */
export async function assertStampedTabIsNotFound(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await expect(readAs(site, "stamped")).rejects.toBeInstanceOf(NotFoundException);
  }, db);
}

/** S9c — `tabs[]` lists the two group tabs of this organization, in order, and never `stamped`. */
export async function assertStampedTabIsNotListed(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, null)).tabs.map((tab) => tab.tabKey)).toEqual(["a", "b"]);
  }, db);
}

const VIEWER: JwtPayload = { sub: "u", email: "viewer@bms.local", name: "Viewer", role: "viewer" };

/** S10a — a caller whose organizations exclude the dashboard's gets 404, never 403. */
export async function assertForeignOrganizationIsNotFound(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const service = serviceOver(site, {
      readableOrganizationIds: async () => [site.foreignOrganizationId],
      readableAssetIds: async () => null,
    });
    await expect(service.forUser(VIEWER, site.dashboardId, undefined)).rejects.toBeInstanceOf(NotFoundException);
  }, db);
}

/** S10b — control: the owning organization reads the same dashboard through `forUser`. */
export async function assertOwningOrganizationReads(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const service = serviceOver(site, {
      readableOrganizationIds: async () => [site.organizationId],
      readableAssetIds: async () => null,
    });
    expect((await service.forUser(VIEWER, site.dashboardId, "b")).scope.assetCount).toBe(2);
  }, db);
}

/**
 * An asset-group caller who may read every asset of the site but holds a grant on ONE group. The
 * stub's scope carries only what `readableGroupScope` reads (`kind`, `assetGroups[].id`).
 */
function groupGrantedService(site: Site, grantedGroupId: string): SiteWidgetsService {
  return serviceOver(site, {
    readableOrganizationIds: async () => [site.organizationId],
    readableAssetIds: async () => [site.a1, site.b1, site.b2],
    currentUser: async () =>
      ({
        scope: { kind: "asset_group", locations: [], assetGroups: [{ id: grantedGroupId }], assetIds: [] },
      }) as never,
  });
}

/** S11a — security L1: a caller granted group A only reads no role of tab B's group. */
export async function assertUnreadableTabGroupCountsNoRole(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await groupGrantedService(site, site.groupA).forUser(VIEWER, site.dashboardId, "b")).roles).toEqual([]);
  }, db);
}

/** S11b — control: the same caller granted group B reads B's role summary. */
export async function assertReadableTabGroupCountsItsRole(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const roles = (await groupGrantedService(site, site.groupB).forUser(VIEWER, site.dashboardId, "b")).roles;
    expect(roles.map((role) => ({ code: role.code, count: role.count }))).toEqual([{ code: "wtp", count: 2 }]);
  }, db);
}

/** Retires `b1` (`active = false`); its uncleared critical alarm stays. */
async function retireB1(site: Site): Promise<void> {
  await site.txDb.execute(sql`UPDATE bms.assets SET active = false WHERE id = ${site.b1}`);
}

/**
 * S12 — one definition of a tab's members: a RETIRED member counts nowhere. `tabs[].status`
 * always read active members only; the rail, the summary and `scope.assetCount` came from
 * `resolveAssetScope`, whose group and location arms do not filter on `assets.active`, so tab
 * B's own rail showed a Critical its status called Normal.
 */
export async function assertRetiredMemberIsNotInTheScope(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await retireB1(site);
    expect((await readAs(site, "b")).scope.assetCount).toBe(1);
  }, db);
}

/** S12b — the retired member's alarm is not on the rail; the active member's warning is. */
export async function assertRetiredMemberIsNotOnTheRail(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await retireB1(site);
    expect((await readAs(site, "b")).alarms.active.map((alarm) => alarm.assetId)).toEqual([site.b2]);
  }, db);
}

/** S12c — the retired member's critical is not in the summary. */
export async function assertRetiredMemberIsNotInTheSummary(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await retireB1(site);
    const summary = (await readAs(site, "b")).alarms.summary;
    expect({
      critical: summary.find((row) => row.code === "critical")?.count,
      warning: summary.find((row) => row.code === "warning")?.count,
    }).toEqual({ critical: 0, warning: 1 });
  }, db);
}

/** S12d — control: the tab's status agrees with its rail — warning, one alarm, one asset. */
export async function assertRetiredMemberTabStatusAgrees(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await retireB1(site);
    const status = tabNamed(await readAs(site, "b"), "b").status;
    expect({ worst: status?.worstSeverity, alarms: status?.activeAlarms, assets: status?.assets }).toEqual({
      worst: "warning",
      alarms: 1,
      assets: 1,
    });
  }, db);
}

/**
 * S13 — AGENTS.md §4.3 / ADR 0043 Amendment 3: `read()` runs on the TENANT handle, under
 * `withTenant`. Only `forUser`'s by-id lookup needs the fleet handle. The fleet handle here
 * throws on `.transaction`, so a read opened on it fails the case.
 */
export async function assertTheReadRunsOnTheTenantHandle(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const fleet = new Proxy(site.txDb, {
      get(target, key, receiver) {
        if (key === "transaction") {
          return () => Promise.reject(new Error("the site-widgets read opened a FLEET transaction"));
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const dto = await readAs(site, "b", null, serviceOver(site, {}, fleet));
    expect(dto.scope.assetCount).toBe(2);
  }, db);
}
