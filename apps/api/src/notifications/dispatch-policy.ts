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
 * the cost is the reads, and `F3.53` (ADR 0041 Amendment 7) has bounded one of
 * the two. The key's own event read still happens once per key per tick: it is
 * what makes the re-dispatch idempotent, and it is never memoised. The hourly
 * ceiling is now read at most once per channel, organization and BUDGET for the
 * whole sweep, because `ClosedCeilings` remembers a refused ceiling — and only a
 * refused one — for the length of the tick that asked. So the first such key on
 * a channel AND BUDGET still costs two reads a tick and every other key on that
 * pair costs one. The budget is not decoration here: a spinning escalation step
 * charges `reserved` and a spinning re-offered raise charges `full`, so a
 * channel spinning both pays one ceiling read for each — a raise must never
 * inherit an event's refusal, which is what the reserve exists for.
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
 * compile error: `TS2366`, because the fall-through returns `undefined` and the
 * declared `boolean` does not admit it under `strictNullChecks` — which
 * `strict: true` in `tsconfig.base.json` turns on. **Not `noImplicitReturns`**,
 * which this paragraph cited until the second review and which is set in no
 * tsconfig in this repository. The guard holds; the flag it named does not
 * exist here. (`F3.54` wrote that sentence and `F3.51` carried it over
 * verbatim, which is how a wrong citation survives a review.)
 *
 * The `event === undefined` branch is
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

/**
 * `F3.52` — which of decision 7's two hourly ceilings a dispatch is measured
 * against (ADR 0041 Amendment 6 §1).
 *
 * **Named for the BUDGET it selects, not for a message kind**, and that is the
 * whole reason the type exists. There are three callers of the ceiling and only
 * two of them carry a message: `sendTest` is neither a raise nor an event — an
 * operator pressing *Send test* on the channels page — so a parameter called
 * `kind` would make that call site a false claim in the code, an argument
 * naming something the caller does not have. `"reserved"` is a true statement
 * about all three.
 */
export type CeilingBudget = "full" | "reserved";

/**
 * `F3.52` — the fraction of a channel's hourly ceiling the reserved budget may
 * reach (ADR 0041 Amendment 6 §1, owner ruling 3).
 *
 * At the default 60 an hour, events stop at 48 and twelve slots stay reachable
 * by a raise alone. The reserve exists because a critical alarm's raise queued
 * behind an escalation backlog is operationally a loss even though `F3.51`'s
 * sweep will eventually deliver it: the harm the row was filed on is a delay,
 * and this is what bounds it.
 */
export const EVENT_SHARE = 0.8;

/**
 * `F3.52` — the ceiling a given budget may reach, out of a channel's
 * configured `ratePerHour` (ADR 0041 Amendment 6 §1).
 *
 * One query, two limits — and since owner ruling 8, two counts to compare them
 * against: `isOverHourlyLimit` returns the trailing hour's `sent` rows and, from
 * the same round trip, the subset of them {@link RESERVED_KEY_PATTERN} matches.
 * The full limit is measured against the first and the reserved limit against
 * the second. There is no second query, no new column and no schema change.
 *
 * **Both limits still apply to a reserved dispatch**, so the channel's hourly
 * total is still `ratePerHour`. Ruling 8 reallocates one fixed budget between
 * two callers; it does not create a second one, and an event that passed the
 * reserved limit is still refused by the full one.
 *
 * **`Math.floor`, and it is load-bearing at the extreme.** `floor(1 * 0.8)` is
 * `0`, so a channel throttled to one message an hour sends raises only — no
 * escalation step and no cleared message at all. Amendment 6 states that
 * consequence and accepts it: a raise is the message an operator cannot do
 * without. A rate of one is the only fixture that separates `floor` from
 * `ceil` and `round`, and `dispatch-policy.spec.ts` holds it for that reason.
 */
export function hourlyCeiling(budget: CeilingBudget, ratePerHour: number): number {
  return budget === "full" ? ratePerHour : Math.floor(ratePerHour * EVENT_SHARE);
}

/**
 * `F3.52` — the budget a dispatch is measured against: an event stops at the
 * reserve, everything else keeps the whole ceiling.
 *
 * The discriminator is the PRESENCE of an event, not its kind. Amendment 6 §1
 * puts "an escalation step or a cleared message" on the reduced limit, which is
 * every `DispatchEvent` there is — so reading `kind` here would add an arm a
 * third event kind could fall through, for no gain.
 *
 * **It reads the same shape as {@link offeredAgainWithoutAsking} and disagrees
 * with it on `reoffered`, on purpose.** That function answers whether a refusal
 * is RECORDED, and a re-offered raise is silent there because the lifecycle
 * sweep will ask again (ADR 0041 Amendment 5). This one answers which CEILING
 * applies, and a re-offered raise is still a raise — it is the exact message
 * the reserve is held for, so demoting it would defeat the reserve at the one
 * dispatch that needs it most. `reoffered` is in the parameter type only so
 * that a `DispatchInput` carrying it satisfies this shape.
 *
 * Structurally typed rather than `Pick<DispatchInput, …>`, for
 * {@link offeredAgainWithoutAsking}'s reason: `DispatchInput` lives in
 * `notifications.service.ts`, which imports this module, and a type-only edge
 * back would be a cycle a reader has to reason about for nothing.
 */
export function budgetFor(input: { event?: DispatchEvent; reoffered?: true }): CeilingBudget {
  return input.event === undefined ? "full" : "reserved";
}

/**
 * `F3.52` security review, owner ruling 8 — the `LIKE` pattern that finds, in
 * the ledger, the rows a RESERVED dispatch wrote.
 *
 * **The invariant, and the reason this constant exists: the rows counted
 * against the reserved limit are exactly the rows written by dispatches that
 * CHARGED the reserved limit.** {@link budgetFor} charges the reserve for every
 * event and `sendTest` asks for it by name, so the ledger-side test has to find
 * an escalation row, a cleared row AND a test-send row. Miss any of the three
 * and the limit stops measuring what it charges: miss the test send, and a burst
 * of manual tests fills the FULL ceiling, eats the raise headroom, and never
 * trips the reserved limit at all.
 *
 * Before ruling 8 there was no such test. One unfiltered `count(*)` was compared
 * against both limits, so the rows a RAISE wrote spent the event share: at the
 * default 60, forty-eight sent raises refused every escalation step, cleared
 * message and test send on the channel while raises went on sending to 60. That
 * is the reserve pointing exactly the wrong way — it exists to keep the last
 * slots reachable BY a raise, not to spend them ON one — and it is what made a
 * step sit long enough for the §2 age budget to abandon it.
 *
 * **What the pattern reads.** The ledger has no column naming the budget a row
 * charged, and adding one would be a schema change for a fact the dedupe key
 * already carries: `buildDedupeKey` writes `rule:alarm:severity` for a raise and
 * appends `:escalation:<n>` or `:cleared` for an event, and `record()` writes
 * `NULL` for a send test, which has no rule and no alarm to key on. So the
 * reserved rows are the NULL keys plus the keys with a fourth segment — three
 * colons — which is what `'%:%:%:%'` asks for.
 *
 * **Structural, not a list of suffixes**, and that is the choice worth reading.
 * `LIKE '%:escalation:%' OR LIKE '%:cleared'` would read the same today and fail
 * OPEN tomorrow: a third `DispatchEvent` kind gets `"reserved"` from
 * {@link budgetFor} the moment it exists, its rows would match neither literal,
 * and events would quietly exceed the reserve with the compiler silent. Any new
 * suffix adds a segment, so the pattern covers it by construction.
 *
 * **The one assumption, and it fails safe.** A raise key stays at three segments
 * only while no part of it contains a colon. The rule and alarm ids are uuids;
 * the severity is a code from `bms.alarm_severities`, whose `code varchar(64)`
 * has no format CHECK (migration `0030`), so an operator-added level called
 * `plant:critical` would give raise rows a fourth segment. They would then count
 * as reserved, events would reach the reserved limit sooner, and the raise path
 * would keep the whole ceiling — the reserve gets stronger, never weaker, and
 * nothing exceeds `ratePerHour`. The three shipped codes are `info`, `warning`
 * and `critical`.
 *
 * Bound as a parameter by drizzle's `like()`, never interpolated, so the `%`
 * characters cannot reach the statement as text.
 */
export const RESERVED_KEY_PATTERN = "%:%:%:%";
