import type { DeliveryResult } from "./notification-transport";
import {
  assert,
  channelRow,
  fakeDb,
  fakeTransport,
  input,
  serviceWith,
} from "./notifications.service.spec";

/**
 * `F3.52` — the `skipped_stale` exit, and WHERE it sits in
 * `dispatchToChannel`'s pre-check ladder (ADR 0041 Amendment 6 §2, ADR 0057
 * Amendment 7).
 *
 * `alarm-lifecycle-escalation-staleness.spec.ts` holds the phase's half: that
 * the input is marked. This file holds the exit's: that a marked input records
 * one row, under the step's own key, **after** the ledger read and **after**
 * the ceiling.
 *
 * **The position is the whole subject, and both neighbouring placements are
 * wrong without being compile errors.** Before the `alreadyRecorded` check the
 * exit would write a row for a step already sent — the phase re-dispatches
 * every due step every tick, and the ledger read is what makes that idempotent
 * (S6). Before the CEILING it would abandon a step for age it spent waiting on
 * budget (S7), which is the interaction the `F3.52` security review measured:
 * the reserve makes raises consume the event budget, so a channel busy with
 * raises refuses every step, and the old order then gave up on each one at 60
 * minutes — converting a late delivery into no delivery at all. Owner ruling 7
 * moved it below the ceiling, and **S7 asserts the opposite of what it
 * asserted when it was written.**
 *
 * S5 and S7 are the pair that pins the order: S5 holds the age deciding under a
 * ceiling the step passes, S7 holds the ceiling deciding first when it does
 * not. Neither alone is the gate.
 *
 * **S9 is the interaction the correctness review found missing**, and it is the
 * one the field actually reaches: a step over the RESERVED limit while the full
 * ceiling still has headroom. S7 gets there by exhausting the whole ceiling at a
 * rate of 1, which any ordering of the two exits would refuse; S9 is the state
 * only the reserve can produce, and owner ruling 8 is what made it reachable
 * without a raise backlog behind it.
 *
 * **Its own file, and one `it()` per case.** `dispatch-budget.spec.ts`'s
 * subject is the ceiling's two budgets; this is a different exit and a
 * different claim. The builders, the fake database and `serviceWith` are
 * `notifications.service.spec.ts`'s exports, imported the way
 * `notifications.events.spec.ts` and `dispatch-budget.spec.ts` already import
 * them.
 */

/** A transport that always sends, so a refusal in these cases is the exit's doing. */
const sendingWebhook = (): ReturnType<typeof fakeTransport> =>
  fakeTransport("webhook", () => Promise.resolve<DeliveryResult>({ status: "sent", error: null }));

/** The escalation step the sweep marked too late: step 1, `stale: true`. */
const staleStep = () => input({ event: { kind: "escalation", step: 1, stale: true } });

/**
 * S5 — a stale step records exactly one row, and nobody is told.
 *
 * The row is the point. `F3.48`'s ceiling exception writes none because the
 * next tick is meant to revisit that key and `isOverHourlyLimit` lifts by
 * itself; an abandonment lifts by nothing, so silence there would cost the only
 * evidence the operator ever gets. Because the status is not `failed`,
 * `eventDeliveryBlocked`'s existing arm then blocks this key for the life of
 * the ledger with no new retry logic — which is what "abandoned" means.
 *
 * **Mutations:** the exit returning `notRecorded` instead of `record` → the row
 * count reddens; the row written under a key without the `:escalation:1`
 * suffix → the key assertion reddens, and that one matters because the raise
 * key is a strict prefix of this one and a row under IT would block the
 * alarm's raise for ever.
 */
export async function testAStaleStepRecordsOneRowAndSendsNothing(): Promise<void> {
  const { db, recorded } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({ db, channels: [], webhook: webhook.transport });

  const results = await service.dispatchToChannels([channelRow()], staleStep());

  assert(
    results[0]?.status === "skipped_stale",
    `S5: a stale step is abandoned, got ${String(results[0]?.status)}`,
  );
  assert(results[0]?.error === null, "S5: an abandonment is a decision, not an error");
  assert(webhook.sent.length === 0, "S5: and it must not reach the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "skipped_stale",
    `S5: exactly one row, and it is the abandonment, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
  assert(
    recorded[0]?.dedupeKey.endsWith(":escalation:1") === true,
    `S5: under the STEP's own key, never the alarm's raise key, got "${String(
      recorded[0]?.dedupeKey,
    )}"`,
  );
}

/**
 * S6 — a step already answered by the ledger writes NO stale row.
 *
 * The exit is after the `alreadyRecorded` check, and this is the only case that
 * says so. The escalation phase re-dispatches every due step on every 30 s
 * tick; the ledger read is what makes that idempotent. An exit placed one block
 * earlier would write a fresh `skipped_stale` row on every tick for a step that
 * was delivered an hour ago — a growing ledger of refusals for a message that
 * was in fact sent.
 *
 * **Mutation:** the exit moved above the `alreadyRecorded` return → red here,
 * and green in S5, S7 and S8.
 */
export async function testAnAlreadyAnsweredStepWritesNoStaleRow(): Promise<void> {
  const { db, recorded, setDeliveryRecorded } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({ db, channels: [], webhook: webhook.transport });

  setDeliveryRecorded(["sent"]);
  const results = await service.dispatchToChannels([channelRow()], staleStep());

  assert(
    results[0]?.status === "skipped_deduped",
    `S6: the ledger answers first, got ${String(results[0]?.status)}`,
  );
  assert(
    recorded.length === 0,
    `S6: a blocked key is the record — nothing is written, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
  assert(webhook.sent.length === 0, "S6: and nothing is sent either");
}

/**
 * S7 — a step the CEILING refused is never abandoned for the age it spent
 * waiting on budget.
 *
 * **This case asserted the exact opposite until owner ruling 7**, and the
 * inversion is the point rather than a detail. The exit used to sit before the
 * ceiling so that an age was never reported as a rate limit.
 *
 * **What the move buys is the REASON, not the message.** The argument for it
 * was that a step refused by the budget could then never be abandoned for age
 * it spent waiting — and a correctness pass falsified that before it was
 * committed. `stepIsTooLate` recomputes each tick from a fixed `raised_at` and
 * an increasing `now`, so once a step is stale it stays stale: the moment the
 * ceiling frees, control reaches the exit and the step is abandoned after all.
 * The end state is identical in both orders. What differs is what an operator
 * reads meanwhile — `skipped_rate_limited` is true and self-clearing while the
 * channel is over budget, where `skipped_stale` would be terminal and premature.
 * Ruling 8's two-count ceiling is what actually reduces the loss, by stopping
 * raises consuming the event budget in the first place.
 *
 * So the ceiling answers first. At a rate of 1 the reserved limit is
 * `floor(1 * 0.8) = 0`, so five `sent` rows are over both limits: the step gets
 * `skipped_rate_limited`, writes **no row** (`F3.48` ruling Q1), and the next
 * tick asks again. S5 holds the other side — the age deciding under a ceiling
 * the step passes.
 *
 * **Mutation:** the exit moved back above the `overLimit` block → every
 * assertion here reddens, and S5 stays green. The pair is what pins the order;
 * neither alone does.
 */
export async function testTheCeilingAnswersBeforeTheAge(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
  });

  setCount(5);
  const results = await service.dispatchToChannels([channelRow()], staleStep());

  assert(
    results[0]?.status === "skipped_rate_limited",
    `S7: budget answers before age — got ${String(results[0]?.status)}`,
  );
  assert(
    recorded.length === 0,
    `S7: and it writes no row, so the next tick retries (F3.48 Q1) — got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
  assert(
    reads.rateLimit === 1,
    `S7: the ceiling IS read for a stale step, got ${reads.rateLimit} read(s)`,
  );
  assert(
    webhook.sent.length === 0,
    "S7: a refused step still reaches no transport",
  );
}

/**
 * S8 — the pair that gates ruling 1: the step is abandoned, the RE-OFFERED
 * RAISE on the same alarm is not.
 *
 * Same fixture, same alarm, same lateness. The escalation step records
 * `skipped_stale`; the raise-retry input — `reoffered: true`, no `event`, the
 * shape `raiseRetryDispatchInput` builds — records no such row and reaches the
 * transport. An absence assertion alone passes when the action never happens,
 * so the positive half is what makes this a gate.
 *
 * **Why it matters more than the two rows it counts.** A `skipped_stale` row
 * under a RAISE key would block that raise for ever:
 * `channelsOwedTheRaise` excludes only `skipped_rate_limited` and a stale
 * `skipped_unconfigured`, so any other row under that key satisfies its
 * blocking arm. The type placement (`stale?: true` on the escalation variant
 * only) and the exit's position inside `input.event !== undefined` are what
 * make such a row unconstructible; this case is what measures it.
 *
 * **Mutation:** any refactor reading staleness off the INPUT rather than off
 * `input.event` — `"stale" in input`, or a `stale` property lifted to
 * `DispatchInput` — → the second half reddens, because the re-offered raise
 * would then be abandoned under the raise key. Moving the exit outside the
 * `input.event !== undefined` block reddens it the same way.
 */
export async function testAReofferedRaiseIsNeverAbandoned(): Promise<void> {
  const { db, recorded } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({ db, channels: [], webhook: webhook.transport });

  const step = await service.dispatchToChannels([channelRow()], staleStep());
  assert(
    step[0]?.status === "skipped_stale",
    `S8: the positive half — the step IS abandoned, got ${String(step[0]?.status)}`,
  );

  const reoffered = await service.dispatchToChannels(
    [channelRow()],
    input({ reoffered: true, raised: true }),
  );
  assert(
    reoffered[0]?.status === "sent",
    `S8: the re-offered raise still goes, got ${String(reoffered[0]?.status)}`,
  );
  assert(webhook.sent.length === 1, "S8: and it reached the transport");
  assert(
    recorded.filter((row) => row.status === "skipped_stale").length === 1,
    `S8: exactly one abandonment, the step's, got ${recorded
      .map((row) => `${row.status}@${row.dedupeKey}`)
      .join(" ")}`,
  );
  const raiseRow = recorded.find((row) => row.status === "sent");
  assert(
    raiseRow !== undefined && !raiseRow.dedupeKey.includes(":escalation"),
    `S8: the raise's row is under the unsuffixed raise key, got "${String(raiseRow?.dedupeKey)}"`,
  );
}

/**
 * S9 — a step 61 minutes past due, refused by the RESERVED limit alone: the
 * status recorded is `skipped_rate_limited`, and no row is written.
 *
 * The interaction case the `F3.52` correctness review found missing. S7 reaches
 * the ceiling by exhausting it outright — a rate of 1 with five sent rows is
 * over the full limit and the reserved one — so it cannot tell an ordering that
 * consults the FULL ceiling first from one that consults both. Here the full
 * ceiling has twelve slots left and only the reserve refuses: the trailing hour
 * holds 48 rows written by dispatches that charged the reserved budget, against
 * a rate of 60 (`floor(60 * 0.8) = 48`). Owner ruling 8 is what makes this state
 * reachable at all — before it, the same refusal came from any 48 rows, raises
 * included, which is the starvation the review measured.
 *
 * The lateness is the sweep's, carried on the input: `stale: true` is what
 * `runEscalationPhase` sets on a step whose `raisedAt` is more than the age
 * budget behind `now`, and the exit under test cannot see a clock.
 *
 * **The absent row is the half that matters most.** `skipped_stale` blocks the
 * step's key for the life of the ledger — `eventDeliveryBlocked`'s "not
 * `failed`" arm — so a stale step abandoned for budget it spent WAITING would
 * never be tried again. Writing nothing is what leaves the key free for the next
 * tick, when the trailing hour has moved on (`F3.48` ruling Q1).
 *
 * **Mutation:** the `skipped_stale` exit moved back above the `overLimit` block
 * → red here, on both the status and the row count, and red in S7. The
 * RESERVED arm of the ceiling removed → also red here, and green in S7, because
 * the full ceiling still refuses there. That second mutation is why this case
 * belongs beside the budget cases as well as the placement ones.
 */
export async function testAStepOverTheReserveIsRefusedRatherThanAbandoned(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: "60" },
  });

  setCount(48, 48);
  const results = await service.dispatchToChannels([channelRow()], staleStep());

  assert(
    results[0]?.status === "skipped_rate_limited",
    `S9: the reserve answers before the age, got ${String(results[0]?.status)}`,
  );
  assert(results[0]?.error === null, "S9: a ceiling refusal is not an error");
  assert(
    recorded.length === 0,
    `S9: and it writes NO row, so the step's key survives for the next tick — got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
  assert(
    reads.rateLimit === 1,
    `S9: the ceiling IS read for a stale step, got ${reads.rateLimit} read(s)`,
  );
  assert(webhook.sent.length === 0, "S9: a refused step still reaches no transport");
}
