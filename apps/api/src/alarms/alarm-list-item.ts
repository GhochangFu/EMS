import { alarms, assets, type BmsDb, locations, rtus } from "@bms/db";
import { type AlarmListItem, alarmSourceSchema } from "@bms/shared";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * The one projection and the one mapper behind every `AlarmListItem` the API
 * produces (`F3.10`, plan D9).
 *
 * Four places build this shape — `AlarmsService.list`, `AlarmsService
 * .acknowledge`, U7's lifecycle sweep for its cleared broadcast, and
 * `readAlarmListItem` below, the `F3.11` listener's read of a `created`
 * alarm by id (ADR 0064 decision 4; it replaced `AlarmRaiser`'s post-insert
 * read-back, which went with the gateway) — and each one used to spell the
 * twelve columns out by hand. `alarmListItemSchema` requires every key and
 * the SPA validates each response through `checkResponse`, so a column added
 * in three of the four places is a runtime failure on the fourth, in
 * whichever path is exercised last. `cleared_at` (ADR 0057 decision 1) is the
 * column that made that concrete: it is on the list, on the socket payload
 * and on the details response, and the sweep is the only writer.
 *
 * **The projection spans five tables.** `assetCode`, `assetName` and
 * `siteName` come from `bms.assets`; `assetRtuName` from `bms.rtus` and
 * `assetLocationName` from `bms.locations` (`F4.316`, ADR 0111). So every
 * consumer of `alarmListItemColumns` must keep its four joins (the fourth below) —
 * `.innerJoin(assets, eq(alarms.assetId, assets.id))`,
 * `.leftJoin(rtus, eq(assets.rtuId, rtus.id))` and
 * `.leftJoin(locations, eq(assets.locationId, locations.id))` — the select
 * does not carry the joins with it, and dropping one is a run-time error, not
 * a type error. The two left joins add no predicate: an asset with no RTU
 * keeps its alarm, with `assetRtuName: null`.
 *
 * **`F3.16` (ADR 0127 decision 12) adds a fourth join**, the alarm's own RTU —
 * `.leftJoin(alarmRtus, eq(alarms.rtuId, alarmRtus.id))` — for `rtuCode` on a
 * `rtu_comms` alarm. It is an alias because `rtus` is already joined as the
 * asset's RTU. A device alarm has no asset, so a reader that must show one
 * left-joins `assets` (`readAlarmListItem` below does); a reader that keeps the
 * inner join keeps excluding device alarms, and says so.
 *
 * `normal_since` is deliberately absent: it is the sweep's own bookkeeping
 * (ADR 0057 decision 5), not a fact the alarm centre shows.
 */
export const alarmRtus = alias(rtus, "alarm_rtu");

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
  assetRtuName: rtus.displayName,
  assetLocationName: locations.name,
  assetName: assets.name,
  siteName: assets.siteName,
  source: alarms.source,
  rtuId: alarms.rtuId,
  rtuCode: alarmRtus.code,
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
  assetId: string | null;
  ruleKey: string | null;
  ruleId: string | null;
  severity: string;
  message: string;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  clearedAt: Date | null;
  assetCode: string | null;
  assetRtuName: string | null;
  assetLocationName: string | null;
  assetName: string | null;
  siteName: string | null;
  source: string;
  rtuId: string | null;
  rtuCode: string | null;
};

/**
 * `bms.alarms.source` as the contract's enum. `alarms_source_check` (migration
 * `0151`) closes the column, so a miss is stored data that broke its contract —
 * a plain `Error` (a 500), never a `ZodError` the global filter would answer as
 * the caller's 400 (ADR 0060).
 */
function sourceOf(r: Pick<AlarmListItemRow, "id" | "source">): AlarmListItem["source"] {
  const parsed = alarmSourceSchema.safeParse(r.source);
  if (!parsed.success) throw new Error(`alarm ${r.id} has an unknown source`);
  return parsed.data;
}

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
    assetRtuName: r.assetRtuName,
    assetLocationName: r.assetLocationName,
    assetName: r.assetName,
    siteName: r.siteName,
    source: sourceOf(r),
    rtuId: r.rtuId,
    rtuCode: r.rtuCode,
  };
}

/**
 * One alarm by id, as the wire shape, or `null` when no row is visible.
 *
 * The one caller is `AlarmNotifyService` (`F3.11`, ADR 0064 decision 4),
 * which hands it the fleet handle — and §4.3 asks for the reason at the call
 * site, so here it is: the read is a system fan-out with no actor. A
 * `NOTIFY` carries no JWT and the alarm may belong to any tenant, so no
 * single organization GUC could be set — the same reasoning as the engine's
 * rule-cache read (`alarm-engine.service.ts`, E7.1b). The per-socket scope is
 * not weakened by it: `AlarmsGateway.emitScoped` filters every socket by its
 * own readable asset set, so the row is read fleet-wide and delivered
 * per-viewer. The joins are the projection's own requirement (see above).
 */
export async function readAlarmListItem(db: BmsDb, alarmId: string): Promise<AlarmListItem | null> {
  const [row] = await db
    .select(alarmListItemColumns)
    .from(alarms)
    // Left: a device alarm (F3.16) has no asset, and its `created` event must
    // still reach the sockets.
    .leftJoin(assets, eq(alarms.assetId, assets.id))
    .leftJoin(rtus, eq(assets.rtuId, rtus.id))
    .leftJoin(locations, eq(assets.locationId, locations.id))
    .leftJoin(alarmRtus, eq(alarms.rtuId, alarmRtus.id))
    .where(eq(alarms.id, alarmId))
    .limit(1);
  return row === undefined ? null : toAlarmListItem(row);
}
