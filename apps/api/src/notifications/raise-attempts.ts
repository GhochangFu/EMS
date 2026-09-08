import { and, inArray } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import type { RaiseAttemptRow, RaiseKeyRef } from "./raise-retry";

/**
 * `F3.51` — the one ledger read the alarm lifecycle sweep's raise-retry phase
 * needs (ADR 0041 Amendment 5, ADR 0057 Amendment 5): every delivery row under
 * a set of alarms' RAISE keys, in one query per tick.
 *
 * **Why this is not a method on `NotificationsService`.** That file stands
 * within a few dozen lines of AGENTS.md §4.5's 1000-line cap and the read gains
 * nothing from being inside the class — it touches no transport, no config and
 * no logger, only `fleetDb`. The precedent is two files away: `channel-reads.ts`
 * was carved out of `channels.service.ts` for exactly this reason, and
 * `AlarmLifecycleService` already imports it and already holds `fleetDb`, so
 * the sweep's wiring is one line and its constructor does not change. The plan
 * for this item allowed for it in advance: if the service crosses the cap, the
 * read is what moves.
 *
 * **`fleetDb` at the call site, and the reason is `isOverHourlyLimit`'s.** The
 * sweep spans every tenant and holds no JWT, so there is no `withTenant` GUC to
 * run under: the organization filter is the `WHERE` clause, not the connection
 * (ADR 0043 Amendment 3, §4.3).
 */

/**
 * The rows under `refs`' keys — **unfiltered by status, and with no `LIMIT`**.
 *
 * **No `status` predicate at all**, and this is the opposite of the shape
 * `eventDeliveryBlocked` uses two files over. Copying its
 * `ne(status, 'skipped_rate_limited')` here would make a channel whose only row
 * under the key is a ceiling refusal come back with ZERO rows;
 * `channelsOwedTheRaise` would read that as "no evidence" (owner ruling Q1) and
 * the raise would never be retried — the third of this item's three cases.
 * `F3.48`'s argument for pushing the exclusion into the `WHERE` was about an
 * unordered SAMPLE of `MAX_EVENT_ATTEMPTS` rows taken under a `LIMIT`; this
 * read takes no `LIMIT`, so there is no sample and the TypeScript grouping in
 * `channelsOwedTheRaise` is exact.
 *
 * **`dedupe_key IN` is load-bearing, not decoration.** Without it the alarm's
 * escalation and cleared rows join the set: one `sent` escalation row would
 * block the raise retry for ever, and three `failed` ones would spend the
 * raise's attempt cap.
 *
 * **The three `IN` lists are independent**, so the read can match a
 * (alarm, key) pair no single ref asked for. That is harmless and deliberate,
 * rather than a bug to be fixed with a tuple `IN`: a raise key is
 * `rule:alarm:severity`, so a key already names its alarm and production cannot
 * write the crossed pair, and the caller groups the rows by alarm and re-checks
 * the organization per ref before the predicate sees them. The suite plants a
 * deliberately inconsistent row (S4/S5) to keep both facts visible.
 *
 * Empty `refs` returns `[]` with no query — `loadEnabledChannelsByIds`'s shape,
 * and drizzle's `inArray` on an empty array is not something to find out about
 * in production.
 *
 * `alarm_id` is nullable on the column (a send test has no alarm), so the rows
 * are narrowed with a `flatMap` rather than a cast.
 *
 * **Index — measured, not asserted.** `notification_deliveries_alarm_idx ON
 * (alarm_id) WHERE alarm_id IS NOT NULL` (migration `0066`) is the access path;
 * the organization and the dedupe key reach the planner as a residual `Filter`.
 * `EXPLAIN (ANALYZE, BUFFERS)` on 20 000 rows over 2 000 alarms, 2026-09-08:
 *
 * ```
 *   1 ref   Index Scan … alarm_idx   rows=10    shared hit=3     0.20 ms
 *   3 refs  Index Scan … alarm_idx   rows=30    shared hit=13    0.12 ms
 *  50 refs  Index Scan … alarm_idx   rows=500   shared hit=160   0.85 ms
 * 300 refs  Index Scan … alarm_idx   rows=3000  shared hit=969   3.27 ms
 * ```
 *
 * No sequential scan at any list size, and the cost tracks the rows returned
 * rather than the table. `F3.10`'s `sentChannelIdsForAlarm` is this index's
 * other reader.
 *
 * **Keep the statement unprepared** — `hasRecordedSkip`'s docblock records why:
 * a generic plan leaves `$n` a parameter, the partial predicate is no longer
 * proved, and the read silently degrades to a scan.
 *
 * Honest bound: the `IN` lists hold one entry per eligible active alarm. At a
 * few hundred open alarms this is fine — 300 refs is 3.3 ms above — and past
 * roughly a thousand the parameter lists are the cost. That is `F3.53`'s
 * ground, not this read's.
 */
export async function loadRaiseAttempts(
  db: BmsDb,
  refs: readonly RaiseKeyRef[],
): Promise<RaiseAttemptRow[]> {
  if (refs.length === 0) {
    return [];
  }
  const alarmIds = [...new Set(refs.map((ref) => ref.alarmId))];
  const organizationIds = [...new Set(refs.map((ref) => ref.organizationId))];
  const dedupeKeys = [...new Set(refs.map((ref) => ref.dedupeKey))];

  const rows = await db
    .select({
      alarmId: notificationDeliveries.alarmId,
      organizationId: notificationDeliveries.organizationId,
      channelId: notificationDeliveries.channelId,
      status: notificationDeliveries.status,
      attemptedAt: notificationDeliveries.attemptedAt,
    })
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.alarmId, alarmIds),
        inArray(notificationDeliveries.organizationId, organizationIds),
        inArray(notificationDeliveries.dedupeKey, dedupeKeys),
      ),
    );

  return rows.flatMap((row) =>
    row.alarmId === null ? [] : [{ ...row, alarmId: row.alarmId }],
  );
}
