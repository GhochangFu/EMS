import { alarms, assets } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";

/**
 * The one projection and the one mapper behind every `AlarmListItem` the API
 * produces (`F3.10`, plan D9).
 *
 * Four places build this shape — `AlarmsService.list`, `AlarmsService
 * .acknowledge`, `AlarmRaiser`'s post-insert read-back and, from U7, the
 * lifecycle sweep's cleared broadcast — and each one used to spell the twelve
 * columns out by hand. `alarmListItemSchema` requires every key and the SPA
 * validates each response through `checkResponse`, so a column added in three
 * of the four places is a runtime failure on the fourth, in whichever path is
 * exercised last. `cleared_at` (ADR 0057 decision 1) is the column that made
 * that concrete: it is on the list, on the socket payload and on the details
 * response, and the sweep is the only writer.
 *
 * **The projection spans two tables.** `assetCode`, `assetName` and `siteName`
 * come from `bms.assets`, so every consumer of `alarmListItemColumns` must
 * keep its `.innerJoin(assets, eq(alarms.assetId, assets.id))` — the select
 * does not carry the join with it, and dropping the join is a run-time error,
 * not a type error.
 *
 * `normal_since` is deliberately absent: it is the sweep's own bookkeeping
 * (ADR 0057 decision 5), not a fact the alarm centre shows.
 */
export const alarmListItemColumns = {
  id: alarms.id,
  assetId: alarms.assetId,
  ruleKey: alarms.ruleKey,
  ruleId: alarms.ruleId,
  severity: alarms.severity,
  message: alarms.message,
  raisedAt: alarms.raisedAt,
  acknowledgedAt: alarms.acknowledgedAt,
  acknowledgedBy: alarms.acknowledgedBy,
  clearedAt: alarms.clearedAt,
  assetCode: assets.code,
  assetName: assets.name,
  siteName: assets.siteName,
};

/**
 * What a `select(alarmListItemColumns)` row holds — spelled out rather than
 * inferred from the drizzle columns so the mapper below reads as the contract
 * it implements, and so a caller may pass any row of this shape — U7's sweep
 * selects `normal_since` and more for its own logic, and maps only the row it
 * broadcasts through here.
 */
export type AlarmListItemRow = {
  id: string;
  assetId: string;
  ruleKey: string | null;
  ruleId: string | null;
  severity: string;
  message: string;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  clearedAt: Date | null;
  assetCode: string;
  assetName: string;
  siteName: string;
};

/** The database row as the wire shape: three `Date`s become ISO strings. */
export function toAlarmListItem(r: AlarmListItemRow): AlarmListItem {
  return {
    id: r.id,
    assetId: r.assetId,
    ruleKey: r.ruleKey,
    ruleId: r.ruleId,
    severity: r.severity,
    message: r.message,
    raisedAt: r.raisedAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: r.acknowledgedBy,
    clearedAt: r.clearedAt?.toISOString() ?? null,
    assetCode: r.assetCode,
    assetName: r.assetName,
    siteName: r.siteName,
  };
}
