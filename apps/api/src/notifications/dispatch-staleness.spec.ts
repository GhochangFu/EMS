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
 * one row, under the step's own key, before the ceiling and after the ledger
 * read.
 *
 * **The position is the whole subject, and two neighbouring placements are
 * wrong without being compile errors.** Before the `alreadyRecorded` check the
 * exit would write a row for a step already sent — the phase re-dispatches
 * every due step every tick, and the ledger read is what makes that idempotent
 * (S6). After the ceiling it would report an age as a rate limit (S7). Neither
 * is visible in S5 alone, which is why S5 is not the gate.
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
 * S7 — over every ceiling, a stale step still reads as stale.
 *
 * The exit is before the ceiling. At a rate of 1 the reserved event limit is
 * `floor(1 * 0.8) = 0`, so five `sent` rows are over both limits and the
 * ceiling would refuse this step if it were ever asked. It is not asked at all,
 * and `reads.rateLimit === 0` is what asserts that directly: an exit placed
 * after the ceiling would report the age as a rate limit, which reads in the UI
 * as "try again later" for a step that will never be tried again.
 *
 * **Mutation:** the exit moved below the `overLimit` block → the status
 * assertion reddens; moved below the ceiling READ but above the block → only
 * the `reads.rateLimit` assertion reddens.
 */
export async function testTheAgeIsDecidedBeforeTheCeiling(): Promise<void> {
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
    results[0]?.status === "skipped_stale",
    `S7: age, not rate — got ${String(results[0]?.status)}`,
  );
  assert(
    recorded.length === 1 && recorded[0]?.status === "skipped_stale",
    `S7: and the row says so too, got ${recorded.map((row) => row.status).join(",")}`,
  );
  assert(
    reads.rateLimit === 0,
    `S7: the ceiling is never even read for an abandoned step, got ${reads.rateLimit} read(s)`,
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
