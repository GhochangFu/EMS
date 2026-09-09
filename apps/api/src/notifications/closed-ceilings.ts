import type { CeilingBudget } from "./dispatch-policy";

/**
 * `F3.53` — the one sweep's memory of which ceilings have already REFUSED, so
 * that a dispatch the ledger has already turned down inside this tick is not
 * asked about again (ADR 0041 Amendment 7, owner rulings 1 and 2).
 *
 * **Only the closed answer is ever remembered.** A `false` is returned and
 * dropped, so no send is ever authorised by memory and decision 7's ceiling is
 * still read from the ledger before every dispatch that could be ADMITTED by
 * it. That asymmetry is not caution for its own sake — it is what the
 * measurement asks for.
 *
 * **The measurement, because the shape rests on it.** Amendment 7 §1 drove the
 * cases over two ticks with the ceiling read counted: a step that SENDS and a
 * step abandoned as `skipped_stale` each pay the read once and are blocked by
 * their own ledger row on the next tick, so neither spins. A step the ceiling
 * REFUSED pays it again on every tick, for ever, because `F3.48` ruling Q1
 * deliberately writes no row for it so the next tick can ask. The only case
 * that spins is therefore the case whose answer is `true`, and remembering the
 * safe half removes all of the measured cost. The row this came from feared the
 * opposite — that the safe half of the fix would be the useless one — and the
 * measurement inverted it.
 *
 * **The key is `channel · organization · budget`**, joined with NUL on
 * `raise-retry.ts`'s `pairKey` precedent: a channel id and an organization id
 * are uuids and a budget is one of two literals, so none of the three can hold
 * the separator and no pair of triples can collide.
 *
 * The BUDGET is in it because Amendment 6 §1 gives the two budgets different
 * limits measured against different counts — the full ceiling against every
 * `sent` row, the reserved ceiling at `floor(rate * EVENT_SHARE)` against the
 * rows a reserved dispatch wrote. A channel over the reserved limit may still
 * be under the full one, and a raise must not inherit an event's refusal: the
 * last twelve slots of every hour exist so a critical alarm's raise gets
 * through a backlog of escalation steps, and a key without the budget would
 * defeat that reserve inside one tick.
 *
 * **The inference that is deliberately NOT made.** A closed `full` logically
 * implies a closed `reserved`, since the full arm applies to a reserved
 * dispatch too and the reserved limit is the lower of the two. This class does
 * not draw it. It would save at most one read per channel per tick — the second
 * budget on a channel already refused once — while adding a rule a reader has
 * to hold to predict what the memo answers, and Amendment 7 fixed the key as
 * the whole triple. The cheap half of the saving is already taken.
 *
 * **A remembered `true` is safe but it is NOT monotone, and this says so rather
 * than claiming otherwise.** `isOverHourlyLimit` recomputes `since` on every
 * call, so the trailing hour's left edge moves and a channel AT its limit can
 * drop below it part-way through a tick. The memo then postpones that dispatch
 * to the next tick. Since `F3.48` such a dispatch is retried, so the cost is
 * bounded at one tick of latency — 30 s, the same bound Amendment 5 and ADR
 * 0057 Amendment 2 already accept for a ceiling-refused dispatch.
 *
 * **The window is the tick.** Amendment 7 ruling 2 puts the construction in
 * `runLifecycleSweep`, so the memo dies with the sweep that made it. There is
 * no TTL and no eviction cap because it never outlives one sweep — `F3.51`
 * ruling 3 replaced a clock constant with a structural condition, and a memo
 * whose lifetime IS its bound keeps that rather than reintroducing one.
 *
 * **Compare `LostLedgerRows` (`raise-retry.ts`), and note the difference.**
 * That class is the other in-process memory the sweep threads through its
 * phases, and it deliberately SURVIVES between ticks: it is the bound on a
 * re-offer whose ledger row could not be written, so forgetting it would
 * restore the unbounded re-offer it exists to stop — which is why it needs a
 * cap and a `retainAlarms` reclaim. This one deliberately does not survive.
 * Nothing here is a bound on anything; it is a cache of an answer that is only
 * true of one trailing hour, and letting it outlive the sweep would be the
 * defect rather than the feature.
 *
 * **Amendment 7 ruling 2 reaches production through `dispatchToChannels`,
 * which is to take the memo as an OPTIONAL argument** — a caller that passes
 * none reads the ledger exactly as it does today. That wiring is the ruling's,
 * not yet this tree's: nothing constructs this class until the sweep does.
 * `dispatchToChannels` has **three** production
 * callers: `dispatchRememberingLostRows`, the site shared by the raise-retry
 * and escalation phases, which passes it and is where all the measured spin is;
 * `notifyCleared`, which does not, because a cleared message has no next tick
 * to be postponed to and the non-monotone edge above would cost the clear
 * itself; and `dispatch()`, the fire-and-forget raise path, which does not,
 * because it runs outside the sweep. **`sendTest` is NOT one of them** — it
 * calls `isOverHourlyLimit` directly and never enters `dispatchToChannels`, so
 * it cannot see a memo on any reading. Amendment 7 first said four callers and
 * named `sendTest`; that was corrected in place in the ADR, and the count is
 * repeated here in its corrected form because a docblock that copied the
 * original sentence is exactly how the error would have survived.
 *
 * Pure — no clock, no database, no logger (AGENTS.md §9.6). The read is the
 * caller's; this class only decides whether to make it.
 */
export class ClosedCeilings {
  private readonly closed = new Set<string>();

  /**
   * Whether this channel is over the ceiling for this budget — from memory if
   * this exact triple has already been refused inside this sweep, otherwise
   * from `read`, whose `true` is then remembered.
   *
   * **One method, taking the read as an argument, and that shape is
   * load-bearing.** The alternative — a `has` the caller consults and an `add`
   * the caller calls — puts two obligations on `dispatchToChannel` that the
   * compiler cannot check: it could consult and forget to remember, which
   * silently restores the whole cost, or remember a `false`, which is the one
   * outcome that could authorise a send past the ceiling. Here the caller never
   * touches the set: it hands over the read, and both mistakes stop being
   * expressible. `LostLedgerRows.add` reports its own outcome for the same
   * reason — a caller that cannot check first cannot check and forget.
   *
   * A rejected `read` propagates unchanged and is NOT remembered: a ledger that
   * cannot answer is not a channel over its ceiling, and one transient failure
   * must not refuse every later dispatch on that key for the rest of the sweep.
   */
  async overLimit(
    channelId: string,
    organizationId: string,
    budget: CeilingBudget,
    read: () => Promise<boolean>,
  ): Promise<boolean> {
    const key = ceilingKey(channelId, organizationId, budget);
    if (this.closed.has(key)) {
      return true;
    }
    const over = await read();
    if (over) {
      this.closed.add(key);
    }
    return over;
  }

  /**
   * How many triples are remembered. Per instance, never a lifetime counter
   * (AGENTS.md §4.6) — it exists for the specs, which use it to show that an
   * open answer was not remembered and that nothing lives at module level.
   */
  get size(): number {
    return this.closed.size;
  }
}

/**
 * A channel, an organization and a budget, joined with a character none of them
 * can hold: the two ids are uuids and {@link CeilingBudget} is `"full"` or
 * `"reserved"`. `raise-retry.ts`'s `pairKey` is the precedent.
 */
function ceilingKey(channelId: string, organizationId: string, budget: CeilingBudget): string {
  return `${channelId}\u0000${organizationId}\u0000${budget}`;
}
