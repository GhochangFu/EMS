import { and, eq, gt, ne, or } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import { MAX_EVENT_ATTEMPTS } from "./dispatch-policy";

/**
 * `F3.53` — the two dedupe-key reads `notifications.service.ts` calls but
 * does not otherwise touch: {@link hasRecordedSkip} and
 * {@link eventDeliveryBlocked}.
 *
 * **A move, not a design.** `notifications.service.ts` sat at 982 of AGENTS.md
 * §4.5's 1000-line cap with a 14-line addition still to land, so the owner
 * ruled at the plan gate that these two come out first. Every line below is
 * byte-identical to its version at `7710e7b6` apart from the three deviations
 * listed below — the commit's gate is that diff, not a green suite.
 * `dispatch-shapes.ts`, `dispatch-policy.ts` and `ledger-text.ts` beside this
 * file are the same precedent, carved out of the same class for the same
 * reason.
 *
 * **Why these two reads and not the others beside them.** Both are
 * `fleetDb`-only: a fire-and-forget probe with no tenant transaction to run
 * under, so the organization filter is the `WHERE` clause and not the
 * connection, and neither needs anything else from the class. That is
 * exactly the service's own rule at its `sentChannelIdsForAlarm` docblock —
 * "outside this class, because the file is at §4.5's cap and the read needs
 * nothing from it but `fleetDb`" — applied to the two reads that already met
 * it, rather than to the one the service kept.
 *
 * **Three deliberate deviations from the original bytes:**
 * 1. The signature line of each function: `private async <name>(...)` became
 *    `export async function <name>(db: BmsDb, ...)`, `db` first.
 * 2. Every `this.fleetDb` became `db` — two call sites, one per function.
 * 3. The `private async` / class-method shape became a free `export async
 *    function` — there is no class here to be private to.
 *
 * Both functions keep their full docblocks intact, including the internal
 * cross-reference between them (`hasRecordedSkip`'s `{ id }` projection vs.
 * `eventDeliveryBlocked`'s `{ status }`) and every citation to the ADRs,
 * rulings and migrations that justify their shape — none of that reasoning
 * changed by moving where the code lives.
 */

/**
 * `F3.46`: `true` when this channel, for THIS organization, already holds a
 * `skipped_deduped` row under this key — the refusal has been answered once
 * and is not recorded again.
 *
 * Same connection and the same reason as `isOverHourlyLimit`: a
 * fire-and-forget read with no tenant transaction to run under, so the
 * organization filter is the `WHERE` clause, not the connection.
 *
 * The `channel_id` equality is served today by the leading column of
 * `notification_deliveries_channel_time_idx`, and the other three predicates
 * filter that channel's own rows. After this change a channel's ledger holds
 * at most one skip row per `(organization, rule, severity)` plus one row per
 * real transition, so the read stays cheap; the partial index on
 * `(channel_id, dedupe_key)` turns it into a single probe once a channel's
 * history reaches the tens of thousands.
 *
 * Concurrency is a growth bound, not an invariant: two sweeps in flight can
 * both read "no row" and both write, which costs one extra row per key per
 * overlapping sweep. There is deliberately no unique index — the ledger is
 * history and stays append-only.
 *
 * The partial index — `0065`'s `WHERE status = 'skipped_deduped'`, replaced
 * by `0066`'s wider `(channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
 * — is usable only while the filters reach the planner as folded constants:
 * an unnamed statement, as drizzle sends today. A `.prepare()` here can
 * switch Postgres to a generic plan, the `$n` stays a parameter, the
 * predicate no longer proves the index's `WHERE`, and the read silently
 * falls back to walking the channel's ledger. Keep it unprepared.
 */
export async function hasRecordedSkip(
  db: BmsDb,
  channelId: string,
  organizationId: string,
  dedupeKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.channelId, channelId),
        eq(notificationDeliveries.organizationId, organizationId),
        eq(notificationDeliveries.dedupeKey, dedupeKey),
        eq(notificationDeliveries.status, "skipped_deduped"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * `F3.10`: `true` when this channel, for THIS organization, has already
 * answered this event's key — the event (an escalation step, a cleared
 * message) is not sent again (ADR 0057 decision 10; owner rulings Q7, Q9).
 *
 * **Which rows consume the key.** A `sent` or `skipped_deduped` row consumes
 * it for the life of the ledger: the event was delivered, or a decision was
 * taken not to deliver it, and a decision is not retried. A `failed` row is a
 * transport that threw or refused, which is not a decision, so the event is
 * retried on the next tick — up to `MAX_EVENT_ATTEMPTS` such rows, after
 * which the key is blocked as if it had been answered (Q9). Two statuses sit
 * between those, each excluded in the `WHERE` below and each for its own
 * reason: `skipped_rate_limited` never blocks (`F3.48` ruling Q2), and
 * `skipped_unconfigured` blocks only while it is newer than the
 * configuration that produced it (`F3.50` ruling Q1).
 *
 * **`skipped_rate_limited` is excluded in the `WHERE`, not here** (`F3.48`
 * ruling Q2, ADR 0057 Amendment 2). It was a blocking status under ruling Q7
 * and is not one now: the ceiling is a rolling hour that lifts by itself, so
 * refusing a step is a postponement rather than a decision. Ruling Q1 stops
 * new such rows being written on the escalation path; excluding the status
 * here releases the ones written before `F3.48` landed.
 *
 * **`skipped_unconfigured` is excluded conditionally** (`F3.50` ruling Q1,
 * ADR 0057 Amendment 3), and the difference from `skipped_rate_limited` is
 * the whole of that row. A ceiling refusal is a self-clearing postponement,
 * so `F3.48` could stop writing it. An unconfigured channel is a
 * **configuration fault an operator must see and fix**, so the row keeps
 * being written and the ledger keeps saying so — it simply stops ANSWERING
 * once it predates `unconfiguredSince`, the later of the channel's
 * `updated_at` and `PROCESS_STARTED_AT`. The `caller` computes that; this
 * read only applies it.
 *
 * **The growth that leaves is one row per key per watermark move** — a
 * process start or any channel PATCH (ruling Q2), not one per restart. A
 * released key is re-offered on the next tick; if the channel is still
 * unconfigured, that tick writes ONE fresh row — which is newer than the
 * watermark, so the second arm below (`status !== "failed"`) blocks the key
 * immediately. The count arm is never reached on this path, and three
 * *fresh* unconfigured rows under one key is not a reachable state.
 *
 * **Unless the hourly ceiling refuses the retry**, in which case `F3.48`
 * ruling Q1 writes nothing and the key stays released, re-offered every tick
 * until the ceiling lifts. That costs two reads a tick and grows the ledger
 * not at all.
 *
 * The exclusion has to be in the SQL for the next paragraph to stay true.
 * The read asks for at most `MAX_EVENT_ATTEMPTS` rows' `status`: fewer than
 * that and every blocking-eligible row under the key was seen, so "any
 * non-`failed`" is exact; that many and the key is blocked whatever they
 * hold, so no order is needed. Filtering the sampled rows in TypeScript
 * instead would break exactly that — an unordered sample of
 * `MAX_EVENT_ATTEMPTS` rows could come back all rate-limited and leave both
 * arms false for a key Q9 blocks.
 *
 * `F3.50` makes that argument load-bearing rather than precautionary.
 * Amendment 2 §3 had to concede its mixed state was unreachable in
 * production; this one is reachable, because one stale unconfigured row
 * accumulates per restart. A key can legitimately hold one `sent` row and
 * three stale `skipped_unconfigured` ones, and a TypeScript filter over an
 * unordered sample of three could then return the three unconfigured rows,
 * empty itself, leave both arms false — and **send an event that was already
 * sent**.
 *
 * Same connection and the same reason as `isOverHourlyLimit`: a read with no
 * tenant transaction to run under — the sweep spans every tenant with no
 * JWT — so the organization filter is the `WHERE` clause, not the
 * connection. Projection `{ status }`, on purpose distinct from
 * `hasRecordedSkip`'s `{ id }`: the unit spec's fake tells the two reads
 * apart by nothing else.
 *
 * Served today by the leading column of
 * `notification_deliveries_channel_time_idx`; migration `0066` adds the
 * `(channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL` probe (plan Q3).
 * No unique index: one loop, sweep-then-sleep, so two ticks never overlap.
 */
export async function eventDeliveryBlocked(
  db: BmsDb,
  channelId: string,
  organizationId: string,
  dedupeKey: string,
  unconfiguredSince: Date,
): Promise<boolean> {
  const rows = await db
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.channelId, channelId),
        eq(notificationDeliveries.organizationId, organizationId),
        eq(notificationDeliveries.dedupeKey, dedupeKey),
        // `F3.48` ruling Q2: a `skipped_rate_limited` row no longer blocks —
        // Q1 stops new ones being written, and this releases the ones already
        // there, including every key blocked before `F3.48` landed.
        //
        // Excluded HERE and not from `rows` below, and that is load-bearing:
        // the read takes `MAX_EVENT_ATTEMPTS` rows with no `ORDER BY`, and
        // the comment above gives order-independence as the reason that is
        // sound. Drawing the sample from the blocking-eligible rows only
        // keeps both arms exact; a filter over an unordered sample would not.
        // `status` is NOT NULL, so `<>` drops nothing else, and
        // `notification_deliveries_channel_key_idx` still serves the read
        // with the status as a residual filter — no DDL. That plan was
        // measured, not assumed; ADR 0057 Amendment 2 §3 records it.
        ne(notificationDeliveries.status, "skipped_rate_limited"),
        // `F3.50` ruling Q1: a `skipped_unconfigured` row answers this key
        // only while it is NEWER than the configuration that produced it.
        // Beside the exclusion above rather than folded into it, because the
        // two statuses leave for different reasons and on different terms: a
        // rate-limited row never blocks again, an unconfigured one blocks
        // until the operator moves the watermark past it.
        //
        // `or(ne, gt)` and not the literal `not(and(eq, lte))`. They are the
        // same predicate — `status` and `attempted_at` are both `NOT NULL` —
        // but the literal form renders `"status" = $n`, and
        // `notifications.events.spec.ts` case 14 asserts that no equality on
        // `status` appears here, because one would block every key that is
        // not the named status. The twin costs nothing and leaves that
        // assertion standing as a free gate on this clause too.
        //
        // **Scoped to this one status, never hoisted into the `and` above.**
        // A watermark over the whole read would drop a `failed` row older
        // than it out of the sample, and ruling Q9's three-attempt cap would
        // silently reset on every channel edit.
        or(
          ne(notificationDeliveries.status, "skipped_unconfigured"),
          gt(notificationDeliveries.attemptedAt, unconfiguredSince),
        ),
      ),
    )
    .limit(MAX_EVENT_ATTEMPTS);
  return rows.length >= MAX_EVENT_ATTEMPTS || rows.some((row) => row.status !== "failed");
}
