import { and, inArray } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import type { RaiseAttemptRow, RaiseKeyRef } from "./raise-retry";

/**
 * `F3.51` — the ledger read the alarm lifecycle sweep's raise-retry phase
 * needs (ADR 0041 Amendment 5, ADR 0057 Amendment 5): every delivery row under
 * a set of alarms' RAISE keys, in one query per BATCH of alarms per tick.
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
 * How many refs one statement binds (`F3.51` review, Medium).
 *
 * The read shipped as ONE statement over every eligible alarm in the fleet.
 * Each ref contributes an `alarm_id` and a `dedupe_key`, and the
 * organizations de-duplicate to one per tenant, so the cost is roughly two
 * bind parameters per eligible alarm. Postgres' extended protocol carries at
 * most **65535** parameters, so the statement failed outright at roughly
 * 32 700 eligible alarms — and `loadActiveAlarms` spans every tenant, so one
 * customer's alarm volume took raise retry away from the whole fleet.
 *
 * 500 is deliberately far below the arithmetic limit rather than close to it.
 * A batch binds at most 500 alarm ids, 500 keys and 500 organization ids —
 * 1500 parameters at the pessimal end, 2.3 % of the budget (case B6). The
 * limit is not the only reason to chunk: a statement holding 65 000
 * parameters plans and transfers badly long before it fails.
 */
export const RAISE_ATTEMPT_BATCH_SIZE = 500;

/** The three de-duplicated `IN` lists one statement binds. */
export type RaiseAttemptBatch = {
  alarmIds: string[];
  organizationIds: string[];
  dedupeKeys: string[];
};

/** What one tick's read gives back — the rows it could read, and what it could not. */
export type RaiseAttemptsRead = {
  /** Every row the batches that RETURNED hold, in batch order. */
  rows: RaiseAttemptRow[];
  /**
   * The alarm ids of every ref whose batch did not return. The caller must
   * decide NOTHING about these this tick — not "owed" and not "not owed":
   * the evidence for them was never read, and a blind re-offer costs a
   * duplicate to every channel of every one of them.
   */
  unread: ReadonlySet<string>;
  /** One reason per failed batch, in batch order — the caller's warn line. */
  reasons: readonly string[];
};

/**
 * `refs` in fixed-size batches, each with its own three de-duplicated lists.
 *
 * Exported so the shape can be asserted directly (case B2). The mutation this
 * exists to kill is the plausible half-fix: chunking the `alarm_id` list while
 * building the other two from the whole `refs` array, which still binds one
 * parameter per alarm per statement and still dies at the limit.
 */
export function raiseAttemptBatches(
  refs: readonly RaiseKeyRef[],
  size: number = RAISE_ATTEMPT_BATCH_SIZE,
): RaiseAttemptBatch[] {
  const batches: RaiseAttemptBatch[] = [];
  for (let start = 0; start < refs.length; start += size) {
    const batch = refs.slice(start, start + size);
    batches.push({
      alarmIds: [...new Set(batch.map((ref) => ref.alarmId))],
      organizationIds: [...new Set(batch.map((ref) => ref.organizationId))],
      dedupeKeys: [...new Set(batch.map((ref) => ref.dedupeKey))],
    });
  }
  return batches;
}

/**
 * The rows under `refs`' keys — **unfiltered by status, and with no `LIMIT`**.
 *
 * **No `status` predicate at all**, and this is the opposite of the shape
 * `eventDeliveryBlocked` uses two files over. Copying its
 * `ne(status, 'skipped_rate_limited')` here would make a channel whose only row
 * under the key is a ceiling refusal come back with ZERO rows;
 * `channelsOwedTheRaise` would read that as "no evidence" (owner ruling 3) and
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
 * **The three `IN` lists are independent within a batch**, so a statement can
 * match a (alarm, key) pair no single ref asked for. That is harmless and
 * deliberate, rather than a bug to be fixed with a tuple `IN`: a raise key is
 * `rule:alarm:severity`, so a key already names its alarm and production cannot
 * write the crossed pair, and the caller groups the rows by alarm and re-checks
 * the organization per ref before the predicate sees them. The suite plants a
 * deliberately inconsistent row (S4/S5) to keep both facts visible. Chunking
 * only NARROWS that reach — a statement can now cross refs within its own
 * batch and no further — so the paragraph stays true and its scope is smaller
 * than it was.
 *
 * **One statement per batch, and a failing batch costs only its own alarms**
 * (`F3.51` review, Medium — see {@link RAISE_ATTEMPT_BATCH_SIZE} for the limit
 * it exists under). The batch loop catches per statement: the surviving
 * batches keep their rows, the failing batch's alarm ids come back in `unread`
 * so the caller can skip exactly those, and `reasons` carries what to warn
 * with. Before this, one failed read returned from the whole PHASE and no
 * tenant's raise was retried.
 *
 * Empty `refs` returns an empty read with no query — `loadEnabledChannelsByIds`'s
 * shape, and drizzle's `inArray` on an empty array is not something to find out
 * about in production.
 *
 * `alarm_id` is nullable on the column (a send test has no alarm), so the rows
 * are narrowed with a `flatMap` rather than a cast.
 *
 * **Index — measured, not asserted.** `notification_deliveries_alarm_idx ON
 * (alarm_id) WHERE alarm_id IS NOT NULL` (migration `0066`) is the access path;
 * the organization and the dedupe key reach the planner as a residual `Filter`.
 * `EXPLAIN (ANALYZE, BUFFERS)` on 20 000 rows over 2 000 alarms, 2026-09-08,
 * measured on the single statement this read used to be — the numbers are
 * therefore **per batch** now, and the 300-ref line is the shape a full batch
 * approaches:
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
 * Honest bound, restated for the chunked shape: the cost per tick is
 * `ceil(eligible / 500)` sequential statements rather than one, so a fleet with
 * ten thousand eligible alarms pays twenty round trips a tick. The denominator
 * is the ELIGIBLE candidates, not the open alarms — `runRaiseRetryPhase` filters
 * out cleared, acknowledged, non-`notify` and organization-less alarms before it
 * builds the refs, and this line said `ceil(alarms / 500)` until `F3.58`
 * measured it. That is a cost, not a failure.
 *
 * **`F3.58` measured that cost and closed it as dropped (2026-09-10) — do not
 * re-file it.** The paragraph above used to add that the cost was unowned and
 * that whoever picked it up should file the row. The row was filed, and the
 * measurement closed it. On the local seeded fleet — 78 active unacknowledged
 * alarms over 78 DISTINCT rules, so the calling phase's per-rule channel cache
 * saved nothing — this read cost **one** round trip a tick while
 * `loadRuleChannels`, in the loop that consumed it, cost **78**.
 *
 * **That 78 is now one as well** (`F3.60`, 2026-09-10, ADR 0041 Amendment 10):
 * the channel read is batched over the distinct evidenced rules, so the
 * comparison this paragraph draws no longer holds and is kept only as the
 * measurement that motivated the row.
 *
 * **That 78 is a figure from before `F3.59` (2026-09-10).** ADR 0057
 * Amendment 9 hoists the phase's organization filter above the channel read and
 * skips a candidate whose row group is empty, so the read is now paid only for
 * an alarm that holds a row under its raise key. This fleet holds zero
 * `notification_deliveries` rows, so on it the guard skips all 78. The figure is
 * kept rather than rewritten because it is what the comparison below was made
 * against; what it is not is the cost of the loop today.
 *
 * **The reason it closed is a comparison of terms, and a first draft of this
 * paragraph got it wrong in a way worth keeping written down.** It called this
 * "the only sublinear per-alarm term in the sweep", which quantified over reads
 * it had not measured. `loadStepChannels` memoises on the distinct channel-id
 * set INSIDE the per-alarm loop, so it divides by the alarm count where this
 * read divides by 500 — this is not even the best-batched term. And
 * `writeAlarmState` issues one `UPDATE` per changing alarm inside its
 * per-organization transaction, which the same draft had called one round trip
 * per organization. What survives carries the ruling on its own: **this read is
 * batched and the terms beside it are linear** — `writeAlarmState` per changing
 * alarm, `notifyCleared` up to twice per cleared alarm, and both dispatch paths
 * once per offered channel. Optimising the batched term while the unbatched ones
 * sit beside it is the weakest available intervention. If a bound is ever owed
 * it is on how many alarms one tick decides — an ADR 0057 question, not this
 * file's. That measurement filed `F3.59` instead, against the channel read —
 * and `F3.59` was built the same day, as ADR 0057 Amendment 9. What it closed is
 * the DEAD read, not the round-trip count: one channel query per distinct rule
 * with an evidence-bearing alarm is still one per rule, and batching those into
 * a single statement is a separate filed row (owner ruling 1).
 *
 * ADR 0041 Amendment 7, which `F3.53` is built under, still does not reach this
 * read, and that stays worth writing down: its memo is keyed on channel,
 * organization and budget, it is consulted only from `dispatchToChannel`, and
 * this is a phase-level batch read on a different key. A reader must not take
 * that closed row as covering this one in either direction.
 */
export async function loadRaiseAttempts(
  db: BmsDb,
  refs: readonly RaiseKeyRef[],
): Promise<RaiseAttemptsRead> {
  const rows: RaiseAttemptRow[] = [];
  const unread = new Set<string>();
  const reasons: string[] = [];

  const batches = raiseAttemptBatches(refs);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch === undefined) {
      continue;
    }
    try {
      rows.push(...(await selectBatch(db, batch)));
    } catch (err) {
      // Per statement, never per phase. The other batches are still read, and
      // the caller is told exactly which alarms it may not decide about.
      for (const alarmId of batch.alarmIds) {
        unread.add(alarmId);
      }
      reasons.push(reasonOf(err));
    }
  }

  return { rows, unread, reasons };
}

async function selectBatch(db: BmsDb, batch: RaiseAttemptBatch): Promise<RaiseAttemptRow[]> {
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
        inArray(notificationDeliveries.alarmId, batch.alarmIds),
        inArray(notificationDeliveries.organizationId, batch.organizationIds),
        inArray(notificationDeliveries.dedupeKey, batch.dedupeKeys),
      ),
    );

  return rows.flatMap((row) =>
    row.alarmId === null ? [] : [{ ...row, alarmId: row.alarmId }],
  );
}

/**
 * §9.6: a cause, bounded, with nothing of the alarm in it.
 *
 * Exported since `F3.60`, which needs the same bound for the same sink — a
 * sweep warn line, not the ledger column, whose own bound is
 * `ledger-text.ts`'s `reasonOf` and is a different number. Shared rather than
 * copied so the two cannot drift apart while both keep this name.
 *
 * **There is a THIRD function of this name and it bounds nothing.**
 * `alarm-lifecycle-phases.ts` exports its own, and all six of that file's warn
 * lines use it — including the two the raise-retry phase writes, one of which
 * interpolates a cause this function produced and one of which does not. The
 * asymmetry is pre-existing and deliberate: bounding one of the six would make
 * that line the odd one out. It is named here so a reader does not take
 * "the same bound for the same sink" as covering every sweep warn line.
 */
export function reasonOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
