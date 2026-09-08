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
 * **`maxAttempts` and `processStartedAt` are parameters, not imports.**
 * `MAX_EVENT_ATTEMPTS` lives in `notifications.service.ts` and
 * `PROCESS_STARTED_AT` in `notifications.config.ts`; importing either at
 * runtime would drag drizzle and Nest into a module whose whole point is that
 * it has neither, and would make a cycle possible the day the service imports
 * this file — which it does, for {@link unconfiguredWatermark}. The one
 * production call site passes the real constants and
 * `alarm-lifecycle-raise-retry.spec.ts` gates that wiring; `raise-retry.spec.ts`
 * case P4b gates that the bound is really the parameter.
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
 * 1. **Evidence** (owner ruling Q1). A channel with ZERO rows under the key has
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
