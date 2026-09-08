import type { NotificationChannelRow } from "./notification-transport";

/**
 * `F3.51` — which channels are still owed an alarm's ORIGINAL raise
 * (ADR 0041 Amendment 5, ADR 0057 Amendment 5).
 *
 * A raise notification that did not send was lost for the life of the alarm.
 * Its outcome is recorded under the key `rule:alarm:severity`; the next
 * evaluation of the same rule arrives with `raised: false` and `alarmId: null`,
 * so `buildDedupeKey` produces a DIFFERENT key, the dispatch lands in the
 * transition-dedupe branch, and nothing is sent. The alarm stays open and the
 * ledger row (`failed`, `skipped_unconfigured` or `skipped_rate_limited`) reads
 * as a delay rather than as a loss. The alarm lifecycle sweep therefore
 * re-offers the raise, and this module is the question it asks first: of the
 * channels joined to the rule, which ones does the ledger say are still owed it?
 *
 * **Pure on purpose, beside `dedupe-key.ts`.** No database, no clock, no
 * `@nestjs/common` — what counts as "still owed" is a decision worth reading on
 * its own, and the sweep's fakes cannot answer it for the suite that gates it.
 *
 * **`maxAttempts` and `processStartedAt` are parameters, not imports, and the
 * reason is the same for both: a parameter is what a suite can move.** Both
 * constants are fixed once per run, so no test can drive the cap to 2 or place
 * a row either side of the watermark by importing them — `F3.50` established
 * exactly that for `PROCESS_STARTED_AT`, and the cap is no different.
 * `raise-retry.spec.ts` cases P4b, P8, P9 and P14 drive the parameters, and
 * `alarm-lifecycle-raise-retry.spec.ts` R3 and R5 gate that the one production
 * call site passes the real constants rather than a literal.
 *
 * **The runtime-weight reason this docblock used to give was false**, and it is
 * struck rather than softened. It said importing either "would drag drizzle and
 * Nest into a module whose whole point is that it has neither, and would make a
 * cycle possible". `notifications.config.ts`, where `PROCESS_STARTED_AT` lives,
 * has **zero** import statements; and since the `F3.51` review
 * `MAX_EVENT_ATTEMPTS` lives in `dispatch-policy.ts`, whose only imports are
 * types. Neither import would cost a byte at runtime and neither would close a
 * cycle. The testability reason above is the whole of it.
 */

/** One alarm's raise key, as the sweep knows it before it reads the ledger. */
export type RaiseKeyRef = {
  alarmId: string;
  organizationId: string;
  /** `buildDedupeKey` of the alarm's ORIGINAL raise input — no event suffix. */
  dedupeKey: string;
};

/** One `bms.notification_deliveries` row under such a key, projected. */
export type RaiseAttemptRow = {
  alarmId: string;
  organizationId: string;
  channelId: string;
  status: string;
  attemptedAt: Date;
};

/**
 * How many lost (alarm, channel, key) triples the sweep remembers at once —
 * see {@link LostLedgerRows}.
 *
 * At a thousand entries the memory is a few hundred kilobytes and the fleet is
 * in a state — a ledger that refuses every insert while its reads succeed —
 * that an operator is already being told about, once per lost row, by
 * `record()`'s `logger.error`.
 */
export const LOST_LEDGER_ROW_CAP = 1_000;

/**
 * `F3.51` review (High) — the (alarm, channel, dedupe key) triples whose
 * delivery row did **not** land, so a phase that re-offers a dispatch on its
 * own stops offering them.
 *
 * **Two phases, one instance, one cap** (`F3.51` second review). The
 * raise-retry phase feeds it under an alarm's raise key and the escalation
 * phase under each due step's own key; `dispatchRememberingLostRows` is the one
 * call either makes. They share the cap as well as the class, so a fleet losing
 * escalation rows can spend the slots the raise path would have used — the
 * degradation below is then the same one, on both paths at once. Lives here,
 * beside the raise predicate, because that is where it was first needed and
 * moving it now would buy a reader nothing.
 *
 * **The hole this closes.** `NotificationsService.record()` catches its own
 * INSERT failure, logs an error and returns the result: ADR 0041 decision 1
 * says a dispatch never fails its caller, and that stands. But if writes fail
 * while reads succeed, no row is ever written under the raise key — so neither
 * `MAX_EVENT_ATTEMPTS` (it counts rows) nor `isOverHourlyLimit` (it counts
 * `sent` rows) can ever engage, and {@link channelsOwedTheRaise} keeps seeing
 * the same one original `failed` row and keeps saying "owed". The retry then
 * sends twice a minute per owed channel for the life of the alarm, with no
 * ledger trace of any of it.
 *
 * **One strike, and it is a consequence rather than a defect.** A single
 * transient insert failure suppresses that triple for the life of the alarm or
 * until the process restarts — even when the SEND failed too, so the message
 * really is still owed. The ledger bound this replaces allows three attempts;
 * this allows none. That follows directly from "refuse rather than forget"
 * below: the class cannot distinguish a transient failure from a permanent one
 * without asking the ledger, and the ledger is the thing that is not answering.
 * A second chance would have to be a count, a count would have to be tuned, and
 * a wrong tuning is the unbounded re-offer this exists to stop. Losing one
 * message is the accepted cost of never sending one twice a minute for ever.
 *
 * **In-process only, and that is deliberate.** The ledger stays the only
 * cross-process state — the same treatment `PROCESS_STARTED_AT` already gives
 * the unconfigured watermark, and for the same reason: a bound that survives a
 * restart would have to be a row, and a row is exactly what could not be
 * written.
 *
 * **A restart is not free, and "a restart loses nothing" would be false.** The
 * memory is empty afterwards while the LEDGER still says the same thing it said
 * before — the old `failed` row is still there and still reads as "owed" — so
 * the first tick after a restart re-offers every pair that was remembered:
 * exactly one extra send per pair. That is small once. It is not bounded under
 * a restart LOOP, and a database refusing writes is precisely when the API may
 * be crash-looping, so the two failures arrive together: every restart replays
 * the whole remembered set. Nothing here bounds that; the ceiling
 * (`isOverHourlyLimit`) is the only thing that does, and it counts `sent` rows
 * that this ledger is not writing either.
 *
 * **Keyed on the dedupe key, not just the pair**, and it carries two distinct
 * loads. A raise key is `rule:alarm:severity` and `raiseRetryDispatchInput`
 * reads the ALARM's severity, so an alarm whose severity is edited under it
 * acquires a different key with no rows under it — a raise that has genuinely
 * never been offered. Keying on `(alarm, channel)` alone would suppress it
 * (case P15). And a step's key adds an `:escalation:<n>` suffix, so the two
 * phases' entries never collide on one alarm and one channel: a lost step row
 * must not silence the raise, nor a lost raise row a step
 * (`alarm-lifecycle-escalation-lost-rows.spec.ts` E1).
 *
 * **Capped, and it refuses rather than forgets.** Past
 * {@link LOST_LEDGER_ROW_CAP} triples `add` reports `false` and that pair falls
 * back to today's unbounded re-offer. Dropping an existing entry to make room
 * would silently un-blacklist a real loss, which is worse than declining to
 * take on a new one (case P16).
 *
 * Pure — no clock, no database, no logger — so it lives here beside the
 * predicate rather than in the sweep. The caller warns.
 */
export class LostLedgerRows {
  private readonly byAlarm = new Map<string, Set<string>>();
  private entries = 0;

  /** The cap in force on THIS instance — the sweep's warn line quotes it. */
  readonly cap: number;

  constructor(cap: number = LOST_LEDGER_ROW_CAP) {
    this.cap = cap;
  }

  /** How many triples are remembered. Per-instance, never a lifetime counter. */
  get size(): number {
    return this.entries;
  }

  /** Remembers one lost row. `false` when the cap refused it — the caller warns. */
  add(alarmId: string, channelId: string, dedupeKey: string): boolean {
    const forAlarm = this.byAlarm.get(alarmId) ?? new Set<string>();
    const entry = pairKey(channelId, dedupeKey);
    // Guards the COUNTER, not the `Set` — `Set.add` is already idempotent, but
    // `entries` is not, and without this a re-add would inflate `size` and
    // bring the cap on early. **No case exercises it**, and that is a fact
    // about the caller rather than about this class: the sweep filters an owed
    // channel out the moment it is in here, so a triple is never offered twice.
    // It is kept so `add` stays correct if that filter ever moves, and named
    // here so a reader does not go looking for the test that drives it.
    if (forAlarm.has(entry)) {
      return true;
    }
    if (this.entries >= this.cap) {
      return false;
    }
    forAlarm.add(entry);
    this.byAlarm.set(alarmId, forAlarm);
    this.entries += 1;
    return true;
  }

  /**
   * `true` when this exact triple is remembered — the phases' filter, asked
   * once per candidate channel before anything is offered. The only reader;
   * `add` reports its own outcome rather than being asked first, so a caller
   * cannot check and forget to record.
   */
  has(alarmId: string, channelId: string, dedupeKey: string): boolean {
    return this.byAlarm.get(alarmId)?.has(pairKey(channelId, dedupeKey)) ?? false;
  }

  /**
   * Drops every alarm outside `alarmIds` — the sweep passes the tick's active
   * set, so an alarm that cleared (or was never seen again) stops costing
   * memory. `cleared_at` is never unset and a re-raise is a new row with a new
   * id, so an evicted alarm does not come back. It covers BOTH phases' entries:
   * they are keyed on the same alarm id, and the raise-retry phase's call frees
   * a dead alarm's escalation entries too.
   *
   * **The reclaim is not guaranteed to run**, and the honest statement is that
   * it is best-effort. It is called from one place — `runRaiseRetryPhase` — and
   * `runLifecycleSweep` returns before every phase when `activeAlarms` is
   * empty, which is the ordinary state of a quiet fleet. So the last tick that
   * had any active alarm is the last one that reclaimed anything, and entries
   * for alarms long since cleared can sit here until the next alarm is raised
   * or the process restarts. That is bounded by {@link LOST_LEDGER_ROW_CAP} and
   * is therefore stale memory rather than a leak — but the cap it eats into is
   * shared with the entries that are still doing work.
   */
  retainAlarms(alarmIds: ReadonlySet<string>): void {
    for (const [alarmId, entries] of this.byAlarm) {
      if (!alarmIds.has(alarmId)) {
        this.entries -= entries.size;
        this.byAlarm.delete(alarmId);
      }
    }
  }
}

/**
 * A channel id and a dedupe key, joined with a character neither can hold: a
 * UUID has no NUL and `buildDedupeKey` composes printable segments.
 */
function pairKey(channelId: string, dedupeKey: string): string {
  return `${channelId}\u0000${dedupeKey}`;
}

/**
 * `F3.50` ruling Q1 — the instant a `skipped_unconfigured` row stops being an
 * answer and becomes history: the later of the two clocks that can have changed
 * a channel's ability to send, its own `updated_at` (a URL, recipients, the
 * kind, a re-saved secret) and the process boundary (`SMTP_HOST`,
 * `CREDENTIAL_ENCRYPTION_KEY`, which no row records).
 *
 * Extracted from `dispatchToChannel`, where `F3.50` wrote it inline and its
 * comment said a helper "would only invite a test that passes while this line is
 * never reached". There are two call sites now — the event path's and this
 * module's — and two call sites are what justifies the helper. Both are
 * reached: `notifications.events.spec.ts` case 15 renders the event read's
 * bound parameters, and `raise-retry.spec.ts` P8/P9/P14 drive this one.
 */
export function unconfiguredWatermark(
  channel: { updatedAt: Date },
  processStartedAt: Date,
): Date {
  return new Date(Math.max(channel.updatedAt.getTime(), processStartedAt.getTime()));
}

/**
 * The channels among `channels` that the ledger shows are still owed the raise,
 * **in the order given**.
 *
 * Three stages per channel, and the order of the stages is the whole function:
 *
 * 1. **Evidence** (owner ruling 3). A channel with ZERO rows under the key has
 *    not been offered the raise yet, so it is NOT owed. This is the same-tick
 *    double-send guard and it replaces any clock or grace constant: on the tick
 *    the raise is first dispatched, the sweep must not offer it a second time.
 *    It is evaluated over EVERY row for the channel, never over the eligible set
 *    below — a rate-limited-only or stale-unconfigured-only channel has evidence
 *    and an empty eligible set, and computing evidence after the exclusions
 *    would silently kill two of the three cases this row exists to fix.
 * 2. **The two status exclusions**, exactly as `eventDeliveryBlocked`'s `WHERE`
 *    applies them: a `skipped_rate_limited` row never blocks (`F3.48` ruling
 *    Q2), and a `skipped_unconfigured` row blocks only while it is NEWER than
 *    {@link unconfiguredWatermark} (`F3.50` ruling Q1).
 * 3. **The two blocking arms**, exactly as `eventDeliveryBlocked` returns them:
 *    `maxAttempts` eligible rows, or any eligible row that is not `failed`.
 *
 * That is `eventDeliveryBlocked`'s predicate unchanged, applied to the raise
 * key, and reusing it whole is owner ruling 2. Hand-rolling "no `sent` row and
 * fewer than three rows" instead would make the unconfigured case a 60-second
 * no-op: the original raise writes row 1, two 30 s retry ticks write rows 2 and
 * 3, the cap is spent inside a minute, and configuring SMTP an hour later
 * changes nothing. That is the falsified premise `F3.48` measured, reproduced on
 * the raise path.
 *
 * **The two exclusions must NOT be pushed into the SQL of
 * `NotificationsService.raiseAttempts`**, and a reviewer who knows `F3.48` will
 * read that as the mistake it forbade unless this paragraph is here. `F3.48`'s
 * "the exclusion belongs in the `WHERE`" argument was about an unordered SAMPLE
 * of `MAX_EVENT_ATTEMPTS` rows taken under a `LIMIT`: filtering a sample in
 * TypeScript can empty it and leave both arms false for a key that is blocked.
 * `raiseAttempts` takes no `LIMIT`, so there is no sample and this grouping is
 * exact. Worse, an exclusion in that `WHERE` would break stage 1: a channel
 * whose only row is `skipped_rate_limited` would come back with zero rows, read
 * as "no evidence", and never be retried — which is the third of this row's
 * three cases.
 */
export function channelsOwedTheRaise(a: {
  channels: readonly NotificationChannelRow[];
  rows: readonly RaiseAttemptRow[];
  maxAttempts: number;
  processStartedAt: Date;
}): NotificationChannelRow[] {
  return a.channels.filter((channel) => {
    // 1. Evidence — over every row for this channel.
    const rowsForChannel = a.rows.filter((row) => row.channelId === channel.id);
    if (rowsForChannel.length === 0) {
      return false;
    }

    // 2. The exclusions, mirroring `eventDeliveryBlocked`'s
    //    `ne(status, 'skipped_rate_limited')` and
    //    `or(ne(status, 'skipped_unconfigured'), gt(attempted_at, watermark))`.
    const watermark = unconfiguredWatermark(channel, a.processStartedAt).getTime();
    const eligible = rowsForChannel.filter(
      (row) =>
        row.status !== "skipped_rate_limited" &&
        (row.status !== "skipped_unconfigured" || row.attemptedAt.getTime() > watermark),
    );

    // 3. The blocking arms, in the same order and with the same operators.
    const blocked =
      eligible.length >= a.maxAttempts || eligible.some((row) => row.status !== "failed");
    return !blocked;
  });
}
