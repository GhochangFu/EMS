import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { ALARM_STATS_MAX_LOCATIONS, ALARM_STATS_TOP_ASSETS, type AlarmStats } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";

/** The answer for an empty asset set, or a window with no alarm. */
function emptyStats(from: Date, to: Date): AlarmStats {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    raised: 0,
    open: 0,
    bySeverity: [],
    byLocation: [],
    moreLocations: false,
    topAssets: [],
    mttaSeconds: null,
    mttrSeconds: null,
    acknowledgedCount: 0,
    clearedCount: 0,
  };
}

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5(b)) — alarm statistics over the
 * given assets for the half-open window `[from, to)` on `raised_at`: counts
 * by severity and by location, the top assets, and the mean times to
 * acknowledge and to clear. The copilot's `get_alarm_stats` calls it once
 * per organization with that organization's readable ids (or a location's
 * readable subtree ids), never `null` and never `[]` (`[]` answers the empty
 * shape here anyway, with no query).
 *
 * The read is `bms.alarms`, a decision-1 tenant-data table, so it runs
 * through `withReadScope` (ADR 0043 decisions 1+3) as `AlarmsService.list`
 * does: one organization's ids run inside `withTenant`, where the `0047`
 * policy bounds the read to the ORGANIZATION only. **Each select's own
 * `a.asset_id = ANY(...)` is therefore the control that keeps a
 * location-scoped or asset-group caller's counts inside the ids it was
 * given**; the integration spec plants an asset of the same organization and
 * location outside the ids and shows each select leaves it out. The
 * predicate is repeated in each select on purpose, so no one of them can
 * lose it by a shared fragment changing.
 *
 * The four selects run in one transaction (one snapshot). `open` is "not
 * cleared now" (`cleared_at IS NULL`, ADR 0057). The means are whole seconds
 * over the window's rows that carry the stamp, `null` when none does.
 * Locations are cut at 25 (one more is read to set `moreLocations`), assets
 * at 10. Nothing here parses (`tests/f4.108-service-parses-are-guarded`):
 * the tool parses the answer through `alarmStatsSchema`.
 */
@Injectable()
export class AlarmStatsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  async range(assetIds: readonly string[], from: Date, to: Date): Promise<AlarmStats> {
    const ids = [...assetIds];
    const lo = from.toISOString();
    const hi = to.toISOString();
    return withReadScope(
      this.db,
      this.fleetDb,
      ids,
      () => emptyStats(from, to),
      async (tx) => {
        const severities = await tx.execute<{ severity: string; raised: number; open: number }>(sql`
          SELECT a.severity,
                 count(*)::int AS raised,
                 (count(*) FILTER (WHERE a.cleared_at IS NULL))::int AS open
            FROM bms.alarms a
           WHERE a.asset_id = ANY(${sql.param(ids)}::uuid[])
             AND a.raised_at >= ${lo}::timestamptz AND a.raised_at < ${hi}::timestamptz
           GROUP BY a.severity
           ORDER BY raised DESC, a.severity`);
        const locations = await tx.execute<{ location_id: string; location_name: string; raised: number; open: number }>(sql`
          SELECT l.id AS location_id,
                 l.name AS location_name,
                 count(*)::int AS raised,
                 (count(*) FILTER (WHERE a.cleared_at IS NULL))::int AS open
            FROM bms.alarms a
            JOIN bms.assets s ON s.id = a.asset_id
            JOIN bms.locations l ON l.id = s.location_id
           WHERE a.asset_id = ANY(${sql.param(ids)}::uuid[])
             AND a.raised_at >= ${lo}::timestamptz AND a.raised_at < ${hi}::timestamptz
           GROUP BY l.id, l.name
           ORDER BY raised DESC, l.name, l.id
           LIMIT ${ALARM_STATS_MAX_LOCATIONS + 1}`);
        const top = await tx.execute<{ asset_id: string; asset_code: string; asset_name: string; raised: number }>(sql`
          SELECT s.id AS asset_id, s.code AS asset_code, s.name AS asset_name, count(*)::int AS raised
            FROM bms.alarms a
            JOIN bms.assets s ON s.id = a.asset_id
           WHERE a.asset_id = ANY(${sql.param(ids)}::uuid[])
             AND a.raised_at >= ${lo}::timestamptz AND a.raised_at < ${hi}::timestamptz
           GROUP BY s.id, s.code, s.name
           ORDER BY raised DESC, s.code
           LIMIT ${ALARM_STATS_TOP_ASSETS}`);
        const times = await tx.execute<{ mtta: number | null; mttr: number | null; acknowledged: number; cleared: number }>(sql`
          SELECT round(extract(epoch FROM avg(a.acknowledged_at - a.raised_at)))::int AS mtta,
                 round(extract(epoch FROM avg(a.cleared_at - a.raised_at)))::int AS mttr,
                 count(a.acknowledged_at)::int AS acknowledged,
                 count(a.cleared_at)::int AS cleared
            FROM bms.alarms a
           WHERE a.asset_id = ANY(${sql.param(ids)}::uuid[])
             AND a.raised_at >= ${lo}::timestamptz AND a.raised_at < ${hi}::timestamptz`);
        const bySeverity = severities.rows.map((row) => ({ severity: row.severity, raised: row.raised, open: row.open }));
        const timing = times.rows[0];
        return {
          from: lo,
          to: hi,
          raised: bySeverity.reduce((sum, row) => sum + row.raised, 0),
          open: bySeverity.reduce((sum, row) => sum + row.open, 0),
          bySeverity,
          byLocation: locations.rows.slice(0, ALARM_STATS_MAX_LOCATIONS).map((row) => ({
            locationId: row.location_id,
            locationName: row.location_name,
            raised: row.raised,
            open: row.open,
          })),
          moreLocations: locations.rows.length > ALARM_STATS_MAX_LOCATIONS,
          topAssets: top.rows.map((row) => ({
            assetId: row.asset_id,
            assetCode: row.asset_code,
            assetName: row.asset_name,
            raised: row.raised,
          })),
          mttaSeconds: timing?.mtta ?? null,
          mttrSeconds: timing?.mttr ?? null,
          acknowledgedCount: timing?.acknowledged ?? 0,
          clearedCount: timing?.cleared ?? 0,
        };
      },
    );
  }
}
