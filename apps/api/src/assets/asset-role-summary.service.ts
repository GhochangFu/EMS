import { Inject, Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";

import { assetGroupMembers } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AssetRoleSummaryItem, AssetRoleSummaryResponse } from "@bms/shared";

import { activeAlarmFilter } from "../alarms/active-alarm-filter";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { LIVE_TELEMETRY_MAX_AGE_SECONDS } from "../telemetry/telemetry-freshness";

interface RoleSummaryRow extends Record<string, unknown> {
  code: string;
  label: string;
  count: number;
  severity_code: string | null;
  severity_label: string | null;
  severity_tone: string | null;
  severity_rank: number | null;
  worst_count: number;
  offline_count: number;
}

/**
 * `F3.28` (ADR 0074, plan task 3.2; owner rulings OQ1, OQ4, OQ6) — the
 * per-role asset summary behind the `/cr-overview` class strip
 * ("MCCs 4 · 1 Critical").
 *
 * One statement, five steps, each with one job so a mutation has one place to
 * land:
 *
 * 1. `members` — the **distinct** `(asset_id, role)` memberships that carry a
 *    role. The same asset holding the same role in two groups counts once; an
 *    asset holding two roles counts under each. A membership with no role is
 *    not a class and never appears.
 * 2. `asset_worst` — each member asset's highest active severity `rank`
 *    (`activeAlarmFilter`: raised and not cleared, acknowledged or not).
 *    Higher `rank` is more urgent (ADR 0032).
 * 3. `live` — the member assets with a sample of **any** point newer than
 *    `LIVE_TELEMETRY_MAX_AGE_SECONDS` (OQ1). The bound is a bound parameter,
 *    never a restated literal — `tests/f3.28-offline-bound-single-source`
 *    holds that.
 * 4. `role_worst` — each role's highest asset rank.
 * 5. The final group counts the role's assets, those at the role's worst rank
 *    (`worstCount`, OQ4) and those not live (`offlineCount`), and joins the
 *    severity back on `rank` (unique, `alarm_severities_rank_key`).
 *
 * `bms.asset_roles` is joined without an `active` filter: a retired role that
 * an asset still holds is still a class on the floor (plan decision 7).
 * Ordered by the role's `sort_order`, then `code`; `label` is verbatim (OQ6).
 *
 * **Scope.** `assetIds` is the caller's already-narrowed scope
 * (`intersectReadable`), routed through `withReadScope`. A single-organization
 * caller runs inside `withTenant`, so the `0047` policy scopes
 * `asset_group_members` and `alarms`; on the fleet branch (an admin or a
 * multi-organization scope) the `inArray` on `members` is the only isolation
 * control. `telemetry.point_values` has no policy, so `asset_worst` and
 * `live` read only assets already in `members`. An empty scope never queries
 * and returns `{ items: [] }`.
 */
@Injectable()
export class AssetRoleSummaryService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  async summarize(assetIds: string[] | null | undefined): Promise<AssetRoleSummaryResponse> {
    const scopeFilter = assetIds ? inArray(assetGroupMembers.assetId, assetIds) : sql`TRUE`;

    const rows = await withReadScope(
      this.db,
      this.fleetDb,
      assetIds,
      () => [] as RoleSummaryRow[],
      async (tx) => {
        const result = await tx.execute<RoleSummaryRow>(sql`
          WITH members AS (
            SELECT DISTINCT asset_group_members.asset_id, asset_group_members.role
            FROM bms.asset_group_members
            WHERE asset_group_members.role IS NOT NULL
              AND ${scopeFilter}
          ),
          asset_worst AS (
            SELECT alarms.asset_id, MAX(sev.rank) AS rank
            FROM bms.alarms
            JOIN bms.alarm_severities sev ON sev.code = alarms.severity
            WHERE ${activeAlarmFilter}
              AND alarms.asset_id IN (SELECT asset_id FROM members)
            GROUP BY alarms.asset_id
          ),
          live AS (
            SELECT DISTINCT pv.asset_id
            FROM telemetry.point_values pv
            WHERE pv.time > now() - make_interval(secs => ${LIVE_TELEMETRY_MAX_AGE_SECONDS}::double precision)
              AND pv.asset_id IN (SELECT asset_id FROM members)
          ),
          per_asset AS (
            SELECT m.role, m.asset_id, w.rank, (l.asset_id IS NULL) AS offline
            FROM members m
            LEFT JOIN asset_worst w ON w.asset_id = m.asset_id
            LEFT JOIN live l ON l.asset_id = m.asset_id
          ),
          role_worst AS (
            SELECT role, MAX(rank) AS worst_rank
            FROM per_asset
            GROUP BY role
          )
          SELECT
            r.code,
            r.label,
            COUNT(*)::int AS count,
            s.code AS severity_code,
            s.label AS severity_label,
            s.tone AS severity_tone,
            s.rank AS severity_rank,
            COUNT(*) FILTER (WHERE pa.rank = rw.worst_rank)::int AS worst_count,
            COUNT(*) FILTER (WHERE pa.offline)::int AS offline_count
          FROM per_asset pa
          JOIN role_worst rw ON rw.role = pa.role
          JOIN bms.asset_roles r ON r.code = pa.role
          LEFT JOIN bms.alarm_severities s ON s.rank = rw.worst_rank
          GROUP BY r.code, r.label, r.sort_order, s.code, s.label, s.tone, s.rank
          ORDER BY r.sort_order, r.code
        `);
        return result.rows;
      },
    );

    return { items: rows.map(toItem) };
  }
}

function toItem(row: RoleSummaryRow): AssetRoleSummaryItem {
  const worstSeverity =
    row.severity_code === null || row.severity_label === null || row.severity_rank === null
      ? null
      : {
          code: row.severity_code,
          label: row.severity_label,
          // `tone` is closed by `alarm_severities_tone_check` in SQL, so the
          // column's `string` is narrowed to the contract's palette here.
          tone: row.severity_tone as NonNullable<AssetRoleSummaryItem["worstSeverity"]>["tone"],
          rank: Number(row.severity_rank),
        };
  return {
    code: row.code,
    label: row.label,
    count: Number(row.count),
    worstSeverity,
    worstCount: Number(row.worst_count),
    offlineCount: Number(row.offline_count),
  };
}
