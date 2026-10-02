import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { MAX_SITE_BREAKER_ROWS, type BreakerRow, type SiteWidgetsResponse } from "@bms/shared";

import { AssetRoleSummaryService, type RoleSummaryGroupScope } from "../assets/asset-role-summary.service";
import type { AccessControlService } from "../auth/access-control.service";
import { withRollback } from "../testing/with-rollback";
import { SiteWidgetsService } from "./site-widgets.service";

/**
 * `F3.74` (plan D8, Task 4.2; ADR 0088 decision 10) — the `breakers` rows and `stateMaps` of the
 * site-widgets read, against a real database. The sibling `.integration.test.ts` owns the pool;
 * the assertions live here (ADR 0014, AGENTS.md §4.6). Every case runs inside `withRollback` and
 * calls `tx.rollback()` (the `F3.60` rule), so nothing commits.
 *
 * **The site.** One organization and site, one group `G` on the tab `sld`, and an `overview` tab
 * with no group. `G` holds, by role:
 * - `main-breaker` (`asset_roles.sort_order` 151): `B-M1` and `B-M2`, and `B-M0`, which the
 *   restricted reader may not read;
 * - `load-feeder-breaker` (154): `A-F1` — first by code, last by role, so an order by code alone
 *   puts it first;
 * - `wtp`: `A-W1`, not a breaker role, so never a row.
 *
 * `B-M1` has a rating and a trip cause; `B-M2` has neither. `B-M1` registers `current_a`, `kw`,
 * `kwh_today`, `breaker_main` (state-mapped by the seed's `bms.point_key_states` rows) and `pf` — a
 * headline key (rank 40) that a top-three statement would pick over the unranked `current_a` and
 * `kwh_today` — all active, and `breaker_trip` INACTIVE. `B-M1` has a `kw` sample and a
 * `breaker_main` 1 sample; `A-F1` holds one active critical alarm.
 *
 * **Needs migrations `0097` (the breaker roles) and `0099`, and the seed's `bms.point_keys` and
 * `bms.point_key_states` rows** (`asset_points.point_key` references the first; the state map is
 * the second).
 */

type Tx = Parameters<Parameters<BmsDb["transaction"]>[0]>[0];

interface Site {
  readonly tag: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly groupId: string;
  readonly domainCode: string;
  readonly dashboardId: string;
  readonly m0: string;
  readonly m1: string;
  readonly m2: string;
  readonly f1: string;
  readonly w1: string;
  readonly txDb: BmsDb;
}

async function one<T>(tx: Tx, query: ReturnType<typeof sql>, what: string): Promise<T> {
  const result = await tx.execute<T & Record<string, unknown>>(query);
  const row = result.rows[0];
  if (!row) throw new Error(`F3.74 breaker-rows fixture: failed to insert ${what}`);
  return row as T;
}

async function seedSite(tx: Tx): Promise<Site> {
  const tag = `F374BR-${randomUUID().slice(0, 8)}`;
  const org = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.organizations (code, name, currency) VALUES (${`${tag}-ORG`}, 'F3.74 breaker-rows org', 'ZAR') RETURNING id`,
    "an organization",
  );
  const loc = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
        VALUES (${org.id}, ${`${tag}-LOC`}, ${tag.toLowerCase()}, 'F3.74 breaker-rows site', 'rsmoc', 0, 0, true)
        RETURNING id`,
    "a location",
  );
  const domain = await one<{ code: string }>(
    tx,
    sql`SELECT code FROM bms.asset_domains ORDER BY sort_order, code LIMIT 1`,
    "a domain lookup (bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed)",
  );
  const group = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
        VALUES (${loc.id}, ${`${tag}-g`.toLowerCase()}, 'F3.74 group G', NULL, ${org.id})
        RETURNING id`,
    "group G",
  );
  const asset = async (code: string, role: string, rating: string | null, tripCause: string | null): Promise<string> => {
    const row = await one<{ id: string }>(
      tx,
      sql`INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, rating, trip_cause)
          VALUES (${org.id}, ${code}, ${`F3.74 ${code}`}, ${`${tag} site`}, ${loc.id}, ${domain.code}, ${rating}, ${tripCause})
          RETURNING id`,
      `asset ${code}`,
    );
    await tx.execute(
      sql`INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES (${group.id}, ${row.id}, ${role})`,
    );
    return row.id;
  };
  // Codes carry the tag as a suffix so the order by code is the letters before it.
  const m0 = await asset(`B-M0-${tag}`, "main-breaker", null, null);
  const m1 = await asset(`B-M1-${tag}`, "main-breaker", "100 A", "high I^2t");
  const m2 = await asset(`B-M2-${tag}`, "main-breaker", null, null);
  const f1 = await asset(`A-F1-${tag}`, "load-feeder-breaker", "16 A", null);
  const w1 = await asset(`A-W1-${tag}`, "wtp", null, null);

  const register = async (assetId: string, key: string, active: boolean): Promise<void> => {
    await tx.execute(
      sql`INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
          VALUES (${org.id}, ${assetId}, ${key}, ${`src_${assetId}_${key}`}, NULL, ${active})`,
    );
  };
  for (const key of ["current_a", "kw", "kwh_today", "breaker_main", "pf"]) {
    await register(m1, key, true);
  }
  await register(m1, "breaker_trip", false);
  await tx.execute(sql`
    INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
      (now() - make_interval(secs => 1), ${m1}, 'kw', 12),
      (now() - make_interval(secs => 1), ${m1}, 'breaker_main', 1)
  `);
  await tx.execute(sql`
    INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
    VALUES (${org.id}, ${f1}, 'critical', 'F3.74 f1 critical', now() - interval '1 minute', NULL)
  `);

  const dashboard = await one<{ id: string }>(
    tx,
    sql`INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
        VALUES (${org.id}, ${`${tag}-site`.toLowerCase()}, 'F3.74 breaker-rows fixture', ${loc.id})
        RETURNING id`,
    "the site dashboard",
  );
  await tx.execute(sql`
    INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
    VALUES (${org.id}, ${dashboard.id}, NULL, NULL, 'overview', 'Overview', 0),
           (${org.id}, ${dashboard.id}, ${loc.id}, ${group.id}, 'sld', 'SLD', 1)
  `);

  return {
    tag,
    organizationId: org.id,
    locationId: loc.id,
    groupId: group.id,
    domainCode: domain.code,
    dashboardId: dashboard.id,
    m0,
    m1,
    m2,
    f1,
    w1,
    txDb: tx as unknown as BmsDb,
  };
}

/** What a read may change from the location dashboard and the location-grant reader. */
interface ReadOptions {
  /** A group-scoped dashboard's row (`locationId` null, or the location arm fires first). */
  readonly dashboard?: { readonly id: string; readonly locationId: null; readonly assetGroupId: string };
  /** The caller's readable groups; defaults to the location grant (or unrestricted for `null`). */
  readonly groups?: RoleSummaryGroupScope;
}

/** One read of `tabKey`; `readable = null` is the unrestricted reader. */
async function readAs(
  site: Site,
  tabKey: string | null,
  readable: readonly string[] | null,
  options: ReadOptions = {},
): Promise<SiteWidgetsResponse> {
  const service = new SiteWidgetsService(
    site.txDb,
    site.txDb,
    {} as AccessControlService,
    new AssetRoleSummaryService(site.txDb, site.txDb),
  );
  return service.read(
    {
      id: options.dashboard?.id ?? site.dashboardId,
      organizationId: site.organizationId,
      locationId: options.dashboard === undefined ? site.locationId : options.dashboard.locationId,
      assetGroupId: options.dashboard?.assetGroupId ?? null,
      assetId: null,
    },
    tabKey,
    readable,
    options.groups !== undefined ? options.groups : readable === null ? null : { locationIds: [site.locationId] },
    Date.now(),
  );
}

/** A dashboard scoped to group `G` itself, with no tab — the shape the builder saves for one group. */
async function groupDashboard(site: Site): Promise<{ id: string; locationId: null; assetGroupId: string }> {
  const result = await site.txDb.execute<{ id: string }>(sql`
    INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
    VALUES (${site.organizationId}, ${`${site.tag}-group`.toLowerCase()}, 'F3.74 group dashboard', ${site.groupId})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("F3.74 breaker-rows fixture: failed to insert the group dashboard");
  return { id: row.id, locationId: null, assetGroupId: site.groupId };
}

/** A second group `H` at the site that also holds `B-M1` — a group the narrow reader may read. */
async function secondGroupHoldingM1(site: Site): Promise<string> {
  const result = await site.txDb.execute<{ id: string }>(sql`
    INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
    VALUES (${site.locationId}, ${`${site.tag}-h`.toLowerCase()}, 'F3.74 group H', NULL, ${site.organizationId})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("F3.74 breaker-rows fixture: failed to insert group H");
  await site.txDb.execute(
    sql`INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES (${row.id}, ${site.m1}, 'main-breaker')`,
  );
  return row.id;
}

/** The restricted reader: every member but `B-M0`. */
function restricted(site: Site): readonly string[] {
  return [site.m1, site.m2, site.f1, site.w1];
}

function rowOf(dto: SiteWidgetsResponse, assetId: string): BreakerRow {
  const found = dto.breakers.find((row) => row.asset.id === assetId);
  if (found === undefined) throw new Error(`no breaker row for ${assetId} in ${JSON.stringify(dto.breakers.map((r) => r.asset.code))}`);
  return found;
}

async function inSite(check: (site: Site) => Promise<void>, db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await check(await seedSite(tx));
    tx.rollback();
  });
}

/** B1a — three rows, by the role's sort order then code: `B-M1`, `B-M2`, then `A-F1`. */
export async function assertRowsAreByRoleSortOrderThenCode(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, "sld", restricted(site));
    expect(dto.breakers.map((row) => row.asset.id)).toEqual([site.m1, site.m2, site.f1]);
  }, db);
}

/** B1b — `roleCode` and `roleLabel` come from `bms.asset_roles` (0097's labels). */
export async function assertRoleLabelIsTheVocabularyLabel(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, "sld", restricted(site));
    expect(dto.breakers.map((row) => [row.roleCode, row.roleLabel])).toEqual([
      ["main-breaker", "Main Breakers"],
      ["main-breaker", "Main Breakers"],
      ["load-feeder-breaker", "Load Feeder Breakers"],
    ]);
  }, db);
}

/** B2a — control: the unrestricted reader sees `B-M0`. */
export async function assertUnrestrictedReaderSeesEveryBreaker(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, "sld", null);
    expect(dto.breakers.map((row) => row.asset.id)).toContain(site.m0);
  }, db);
}

/** B2b — `B-M0` is outside the caller's readable set: no row for it. */
export async function assertUnreadableBreakerIsAbsent(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dto = await readAs(site, "sld", restricted(site));
    expect(dto.breakers.map((row) => row.asset.id)).not.toContain(site.m0);
  }, db);
}

/** B3a — `rating` and `tripCause` are the asset's own columns. */
export async function assertRatingAndTripCausePassThrough(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.m1);
    expect({ rating: row.rating, tripCause: row.tripCause }).toEqual({ rating: "100 A", tripCause: "high I^2t" });
  }, db);
}

/** B3b — unset, both are `null`. */
export async function assertUnsetRatingAndTripCauseAreNull(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.m2);
    expect({ rating: row.rating, tripCause: row.tripCause }).toEqual({ rating: null, tripCause: null });
  }, db);
}

/**
 * B4a — `asset.points` is the three table keys and the active state-mapped key, never another
 * headline key (`pf`) and never an inactive state key (`breaker_trip`).
 */
export async function assertPointsAreTheTableKeysAndStateKeys(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.m1);
    expect(row.asset.points.map((point) => point.pointKey).sort()).toEqual(["breaker_main", "current_a", "kw", "kwh_today"]);
  }, db);
}

/** B4b — a point's newest sample reaches `latest`, and makes the asset live. */
export async function assertPointLatestAndFreshness(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.m1);
    expect({
      kw: row.asset.points.find((point) => point.pointKey === "kw")?.latest?.value,
      freshness: row.asset.freshness,
    }).toEqual({ kw: 12, freshness: "live" });
  }, db);
}

/** B4c — a breaker with no registered point answers no point. */
export async function assertUnregisteredBreakerHasNoPoints(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.m2);
    expect(row.asset.points).toEqual([]);
  }, db);
}

/** B5a — the Overview tab (no group) answers no breaker row. */
export async function assertOverviewTabHasNoBreakers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, "overview", null)).breakers).toEqual([]);
  }, db);
}

/** B5b — the LOCATION dashboard's own read (no `?tab=`) answers no breaker row either (B8a: a group dashboard's does). */
export async function assertDashboardReadHasNoBreakers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, null, null)).breakers).toEqual([]);
  }, db);
}

/** B6a — `stateMaps` holds the map of the state key seen (`breaker_main`), and only it. */
export async function assertStateMapsHoldTheKeysSeen(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, "sld", restricted(site))).stateMaps).toEqual([
      {
        pointKey: "breaker_main",
        states: [
          { value: 0, label: "OPEN", tone: "open" },
          { value: 1, label: "CLOSED", tone: "closed" },
        ],
      },
    ]);
  }, db);
}

/** B6b — the Overview answers no state map. */
export async function assertOverviewHasNoStateMaps(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, "overview", null)).stateMaps).toEqual([]);
  }, db);
}

/**
 * B8a — ADR 0088 decision 10, "every member of the five breaker roles in the bound group": a
 * dashboard scoped to group `G`, read with no tab, answers `G`'s breakers (the mimic's
 * `mimicGroupFor` fallback to `dashboard.assetGroupId`). Mutation: pass `tabGroupId` alone => red.
 */
export async function assertGroupDashboardWithNoTabHasBreakers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const dashboard = await groupDashboard(site);
    const dto = await readAs(site, null, restricted(site), { dashboard });
    expect(dto.breakers.map((row) => row.asset.id)).toEqual([site.m1, site.m2, site.f1]);
  }, db);
}

/**
 * B8b — a LOCATION dashboard's Overview binds no group, and the fallback has none to fall back to,
 * so it still answers `[]` (B5a with the narrowed reader). Mutation: fall back to the first readable
 * candidate group => red.
 */
export async function assertLocationOverviewStillHasNoBreakers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    expect((await readAs(site, "overview", restricted(site))).breakers).toEqual([]);
  }, db);
}

/**
 * B2c — security L1 (owner ruling 2026-09-24): an asset-group-grant reader with no grant on `G`
 * reads the `sld` tab. `B-M1` is also in group `H`, which the reader may read, so the asset
 * narrowing alone keeps `B-M1` in scope; the group narrowing must answer no breaker at all.
 * Mutation: pass the effective group without the `readableGroupIds` check => red.
 */
export async function assertUngrantedGroupHasNoBreakers(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const h = await secondGroupHoldingM1(site);
    const dto = await readAs(site, "sld", [site.m1], { groups: { groupIds: [h] } });
    expect(dto.breakers).toEqual([]);
  }, db);
}

/**
 * B2d — B2c's control: the same readable asset with the grant on `G` itself answers `B-M1`'s row,
 * so B2c's `[]` is the group narrowing and not the asset narrowing.
 */
export async function assertGrantedGroupHasItsBreaker(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await secondGroupHoldingM1(site);
    const dto = await readAs(site, "sld", [site.m1], { groups: { groupIds: [site.groupId] } });
    expect(dto.breakers.map((row) => row.asset.id)).toEqual([site.m1]);
  }, db);
}

/**
 * B9 — the member statement is capped at `MAX_SITE_BREAKER_ROWS` (the contract's `.max()`): `G`
 * holds 65 more `main-breaker` members than the fixture's four. Mutation: drop the `LIMIT` => red.
 */
export async function assertBreakerRowsAreCapped(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    await site.txDb.execute(sql`
      WITH made AS (
        INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
        SELECT ${site.organizationId}, ${`C-`} || lpad(n::text, 3, '0') || ${`-${site.tag}`}, 'F3.74 cap breaker',
               ${`${site.tag} site`}, ${site.locationId}, ${site.domainCode}
        FROM generate_series(1, ${MAX_SITE_BREAKER_ROWS + 1}) AS n
        RETURNING id
      )
      INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
      SELECT ${site.groupId}, id, 'main-breaker' FROM made
    `);
    const dto = await readAs(site, "sld", null);
    expect(dto.breakers.length).toBe(MAX_SITE_BREAKER_ROWS);
  }, db);
}

/** B7 — a row's open-alarm count and its most severe open alarm. */
export async function assertRowCarriesItsAlarms(db: BmsDb): Promise<void> {
  await inSite(async (site) => {
    const row = rowOf(await readAs(site, "sld", restricted(site)), site.f1);
    expect({ activeAlarms: row.activeAlarms, severity: row.topAlarm?.severity, message: row.topAlarm?.message }).toEqual({
      activeAlarms: 1,
      severity: "critical",
      message: "F3.74 f1 critical",
    });
  }, db);
}
