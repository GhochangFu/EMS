import type { DispatchEvent } from "./dedupe-key";
import type { DeliveryResult } from "./notification-transport";

/**
 * `F3.51` review — the two policy decisions `dispatchToChannel` makes about
 * the LEDGER rather than about a message, and the shape it reports back.
 *
 * Carved out of `notifications.service.ts`, which stood at 958 of AGENTS.md
 * §4.5's 1000-line cap before the review's High finding needed room. Nothing
 * here touches the class: `MAX_EVENT_ATTEMPTS` is a constant, and
 * {@link offeredAgainWithoutAsking} is a pure function of the input. The
 * precedent is `raise-retry.ts` and `channel-reads.ts` — when this file is at
 * the cap, what moves is the part that needs nothing from `this`.
 *
 * The constant is imported from here by `alarm-lifecycle.service.ts` and two
 * suites; there is deliberately **no re-export** from
 * `notifications.service.ts`, because two import paths for one constant is the
 * drift shape this repository keeps finding.
 */

/**
 * `F3.10` (owner ruling Q9, 2026-09-06): how many `failed` rows an event's key
 * may hold on one channel before the event stops being retried.
 *
 * A transport failure is not a decision. A webhook that timed out at 03:00
 * should be tried again on the next tick, where a deduped step should not —
 * but an unbounded retry would let one dead endpoint grow the ledger by a row
 * per tick for the life of the alarm. Three rows per key per channel is the
 * growth bound; `eventDeliveryBlocked` reads at most this many and blocks the
 * key once it finds them.
 *
 * A step the hourly ceiling refused is retried too, since `F3.48`, and it
 * never spends an attempt: ruling Q1 writes no row for it, so there is nothing
 * for this bound to count. **Nothing else bounds it either.** The ceiling's
 * trailing hour decides when a slot frees, not how long the retry runs, so a
 * channel held permanently over a misconfigured ceiling retries for the life of
 * the alarm — writing nothing, sending nothing. ADR 0057 Amendment 2 §2 accepts
 * that; it is not an oversight in this constant.
 *
 * A step an unconfigured channel refused is retried too, since `F3.50`, and it
 * IS bounded — by the second arm rather than by this one. Ruling Q1 keeps
 * writing the row (an operator must see a configuration fault), and releases
 * the key only once the row predates the channel's `updated_at` or the process
 * start. A retry that reaches a write then writes ONE fresh row, which is newer
 * than that watermark, so `eventDeliveryBlocked`'s `status !== "failed"` arm
 * blocks the key at the very next tick. **One row per key per WATERMARK MOVE**
 * — a process start or any channel PATCH, ruling Q2 — not per restart; this
 * count is never reached on that path.
 *
 * One carve-out, and it is where the two retries meet: if the hourly ceiling
 * refuses the released step, `F3.48` ruling Q1 writes no row at all, so the key
 * is NOT blocked again and the step is re-offered every tick until the ceiling
 * lifts. Nothing is written and nothing is sent, so the ledger does not grow —
 * the cost is two reads per tick per such key, which `F3.53` owns.
 *
 * **`F3.51` — an alarm's RAISE key now enters this same accounting** (ADR 0041
 * Amendment 5, owner ruling 2). It reaches it through `channelsOwedTheRaise`
 * rather than through `eventDeliveryBlocked`, but the predicate is the same
 * one, so every paragraph above transfers unchanged: this many `failed` rows
 * under the raise key stop the lifecycle sweep re-offering it on that channel,
 * a ceiling-refused re-offer writes no row and spends nothing, and a
 * `skipped_unconfigured` refusal is bounded by the "not failed" arm at one row
 * per watermark move. The two accountings do not mix — `loadRaiseAttempts`
 * filters on the dedupe key, and a step's key is never the raise's.
 *
 * **Every paragraph above counts ROWS, and a row that was not written counts
 * for nothing** (`F3.51` review, High). This constant bounds a retry only
 * while `record()`'s insert lands. If the ledger refuses writes while serving
 * reads, no row appears under the key, this count never reaches three, and the
 * dispatch is re-offered every 30 s for the life of the alarm.
 *
 * That is true of **both** paths the sweep re-offers on, and the hole is now
 * closed on both: the raise retry under the raise key, and the escalation phase
 * under each step's key (`F3.51` second review — the first closed the raise
 * path only, and `runEscalationPhase` went on discarding its outcomes). It is
 * closed outside this constant, by `LostLedgerRows` in `raise-retry.ts`:
 * `record()` reports whether its row landed ({@link DispatchOutcome}), and each
 * phase stops offering a triple whose row did not. The two memories share one
 * class, one instance and one cap, and never one key — a lost step row must not
 * silence the raise, and a lost raise row must not silence a step. In process,
 * not in the ledger — a bound that survived a restart would have to be a row,
 * and a row is what could not be written.
 *
 * A cleared message needs none of this: nothing re-offers it, so a lost row
 * costs the evidence and no bound.
 */
export const MAX_EVENT_ATTEMPTS = 3;

/**
 * `F3.51` review (High) — what `dispatchToChannels` reports per channel.
 *
 * A {@link DeliveryResult} — the transports' own shape, unchanged and still
 * what `record()` stores — plus the two facts a caller cannot get from the
 * ledger afterwards, because the whole point of `rowLost` is that the ledger
 * does not have them.
 *
 * **`rowLost`, and not `written`.** It is `true` in exactly one case: an
 * insert was attempted and it threw. It is **`false` at the exits that
 * deliberately write no row** — {@link offeredAgainWithoutAsking}'s three —
 * and calling those "not written" would be true of the ledger and wrong for
 * the caller. A ceiling-refused re-offer writes nothing ON PURPOSE so the next
 * tick can ask again (`F3.48` ruling Q1); a caller that treated it as a lost
 * row would stop offering it and undo that fix on the raise path, which is
 * what `alarm-lifecycle.integration.spec.ts` I2 holds.
 *
 * `channelId` rides along because `dispatchToChannels` drops channels from
 * another organization (M2), so the results are not index-aligned with the
 * list the caller passed.
 *
 * A superset of `DeliveryResult`, so every caller that reads `.status` and
 * `.error` — `rule-actions.ts`, the controller, every suite — is untouched.
 */
export type DispatchOutcome = DeliveryResult & {
  channelId: string;
  rowLost: boolean;
};

/**
 * `F3.54` — whether a dispatch this refusal belongs to will be **offered
 * again** without anyone asking (ADR 0057 Amendment 4).
 *
 * This is the property the three event-path exceptions to ADR 0041 decision 4
 * actually turn on, and naming it is the point. An escalation step is
 * re-dispatched by `runEscalationPhase` on every 30 s tick until it lands, so
 * writing no row IS its retry and a row would spend its key. A cleared message
 * is dispatched once from the clear phase and `loadActiveAlarms` never returns
 * that alarm again, so silence buys nothing and costs the only evidence. The
 * ORDINARY raise is not an event and nothing re-offers it: its refusal is
 * bounded by the transition, the next raise is a new alarm with a new key, and
 * the row is the only evidence anybody has that the message was refused.
 *
 * **`F3.51` (ADR 0041 Amendment 5) adds the fourth case, and it is the first
 * that is not an event.** The alarm lifecycle sweep re-offers an alarm's
 * original raise on every 30 s tick until it lands, so a dispatch carrying
 * `reoffered` has exactly the escalation step's property and none of the
 * cleared message's: writing no row IS its retry, and a row would spend one of
 * its key's {@link MAX_EVENT_ATTEMPTS} on a refusal the next tick is meant to
 * revisit. That the answer is now read off `reoffered` rather than off `event`
 * is why `F3.54` named this function for the property instead of the kind —
 * testing `kind === "escalation"` inline would have had to be revisited at
 * three call sites instead of one.
 *
 * **Exhaustive on purpose** (security review, `F3.54`). The three call sites
 * used to test `kind === "escalation"` inline, which is correct for today's two
 * kinds and silently wrong for a third: a new retried kind would fall to the
 * `record()` branch and poison its own key for every later tick, with the
 * compiler reporting nothing. Here a third kind is a missing return, which is a
 * compile error under `noImplicitReturns`. The `event === undefined` branch is
 * not a default and does not weaken that: it answers the two raise cases and
 * every event kind still reaches the switch.
 *
 * Structurally typed rather than `Pick<DispatchInput, …>`: `DispatchInput`
 * lives in `notifications.service.ts`, which imports this module, and a
 * type-only edge back would be a cycle a reader has to reason about for
 * nothing. Every `DispatchInput` satisfies this shape.
 */
export function offeredAgainWithoutAsking(input: {
  event?: DispatchEvent;
  reoffered?: true;
}): boolean {
  if (input.event === undefined) return input.reoffered === true;
  switch (input.event.kind) {
    case "escalation":
      return true;
    case "cleared":
      return false;
  }
}
