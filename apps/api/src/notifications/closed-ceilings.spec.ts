import { ClosedCeilings } from "./closed-ceilings";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.53` — the seven claims {@link ClosedCeilings} makes (ADR 0041
 * Amendment 7, owner rulings 1 and 2).
 *
 * The subject is a memo that remembers **only** the closed answer, for the
 * length of one sweep. Two halves have to be measured separately and both are
 * here: that a closed ceiling is remembered (C1) — without which the memo saves
 * nothing — and that an open one never is (C2), which is the half that would
 * authorise a send from memory. The other five say the key is exactly
 * `channel · organization · budget`, that a failed read is not an answer, and
 * that nothing lives at module level.
 *
 * **One exported function per claim, and one `it()` per function** in the
 * sibling `.test.ts`, on `dispatch-budget.spec.ts`'s precedent. `assert`
 * throws, so a suite that puts every claim in one `it()` reddens at the FIRST
 * failing block and never runs the block that owns the claim (AGENTS.md §4.6:
 * a mutation must redden THAT assertion). Every case below names the mutation
 * it kills, and each mutation was applied and run.
 *
 * **Every case owns its channel and organization ids**, so no two cases share a
 * key. That is what keeps the module-level mutation C7 kills from reddening
 * cases that are not about it — and where it still does, C1 and C2 say so.
 *
 * **Every counter is per fixture.** Each case builds its own {@link Probe} and
 * asserts that probe's `calls`; nothing here reads a lifetime statistic
 * (AGENTS.md §4.6).
 *
 * Nothing in this file touches a database, a clock or a service. The memo is a
 * `Set` and a key function, and the ledger read is the callback the case
 * supplies.
 */

/** A ceiling read that counts its own calls. `calls` is per instance. */
type Probe = {
  read: () => Promise<boolean>;
  calls: number;
};

/**
 * A ceiling read that answers `answers[n]` on call `n` and repeats the last
 * answer once the list runs out.
 *
 * The count is the measurement in most cases below: "the memo did not ask"
 * cannot be read off the return value, because a remembered `true` and a fresh
 * `true` are the same `true`.
 */
function answering(...answers: readonly [boolean, ...boolean[]]): Probe {
  const probe: Probe = {
    calls: 0,
    read: () => {
      const answer = answers[Math.min(probe.calls, answers.length - 1)];
      probe.calls += 1;
      return Promise.resolve(answer);
    },
  };
  return probe;
}

/** What C6's first read rejects with, asserted so the memo is shown to propagate it unchanged. */
const LEDGER_DOWN = "C6 ledger unavailable";

/**
 * A ceiling read that REJECTS on its first call and answers `answer` on every
 * call after it — the ledger going down for one dispatch and coming back.
 */
function failingThenAnswering(answer: boolean): Probe {
  const probe: Probe = {
    calls: 0,
    read: () => {
      probe.calls += 1;
      return probe.calls === 1
        ? Promise.reject(new Error(LEDGER_DOWN))
        : Promise.resolve(answer);
    },
  };
  return probe;
}

/**
 * C1 — a closed ceiling is remembered, and the second dispatch does not ask.
 *
 * This is the whole saving. Amendment 7 §1 measured that a ceiling-refused
 * dispatch is the ONE case that pays the read again on every tick, because
 * `F3.48` ruling Q1 deliberately writes no row for it; within one sweep three
 * channels on one step cost three reads and every later step on the same
 * channel costs another. Remembering the refusal removes all of them.
 *
 * The read count is the claim. The two returns are both `true` whether or not
 * the memo works, so `calls === 1` is the only assertion that separates a memo
 * from a passthrough.
 *
 * **Mutation:** the `add` after a `true` deleted → `assert` stops at the read
 * count, printing `C1: the second dispatch must not ask the ledger, got 2`.
 * It also reddens C7, whose per-instance `size === 1` needs the same `add`
 * (`C7: one sweep's memo holds only its own key, got 0`); that is the owner and
 * a neighbour, not a miss.
 */
export async function testAClosedCeilingIsRememberedAndNotAskedAgain(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = answering(true);

  const first = await memo.overLimit("c1-channel", "c1-org", "reserved", probe.read);
  const second = await memo.overLimit("c1-channel", "c1-org", "reserved", probe.read);

  assert(first === true, `C1: the ledger says the channel is over its ceiling, got ${first}`);
  assert(second === true, `C1: and the memo says so too, got ${second}`);
  assert(probe.calls === 1, `C1: the second dispatch must not ask the ledger, got ${probe.calls}`);
  assert(memo.size === 1, `C1: one key is remembered, got ${memo.size}`);
}

/**
 * C2 — an OPEN ceiling is never remembered, and every dispatch asks again.
 *
 * The half of ruling 1 that keeps the memo safe. A cached `false` would
 * authorise a send from memory: `isOverHourlyLimit` recomputes the trailing
 * hour on every call, so a channel that was under its ceiling at the top of a
 * sweep can reach it part-way through, and a remembered `false` would go on
 * sending past the ceiling for the rest of the tick with no row and no read to
 * stop it. Decision 7's ceiling is read from the ledger before every dispatch
 * that could be ADMITTED by it, and that is what this case holds.
 *
 * **Mutation:** the `add` made unconditional (remember whatever `read`
 * answered) → the second call is answered `true` from memory and `assert`
 * stops there, printing `C2: and it is asked again rather than remembered, got
 * true`. `calls === 1` and `size === 1` are the same defect one assertion on,
 * and neither runs — which is the shape this file's header is about: one
 * throwing `assert` reports one claim, so the claim has to be the first one.
 */
export async function testAnOpenCeilingIsNeverRemembered(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = answering(false);

  const first = await memo.overLimit("c2-channel", "c2-org", "full", probe.read);
  const second = await memo.overLimit("c2-channel", "c2-org", "full", probe.read);

  assert(first === false, `C2: the channel is under its ceiling, got ${first}`);
  assert(second === false, `C2: and it is asked again rather than remembered, got ${second}`);
  assert(probe.calls === 2, `C2: both dispatches read the ledger, got ${probe.calls}`);
  assert(memo.size === 0, `C2: an open answer is never remembered, got ${memo.size}`);
}

/**
 * C3 — the BUDGET is part of the key: a raise does not inherit an event's
 * refusal.
 *
 * Amendment 6 §1 gives the two budgets different limits measured against
 * different counts — the full ceiling against every `sent` row, the reserved
 * ceiling at `floor(rate * 0.8)` against the rows a reserved dispatch wrote —
 * so a channel over the reserved limit may still be under the full one. Twelve
 * of sixty slots exist precisely so a critical alarm's raise gets through a
 * backlog of escalation steps, and a memo keyed on the channel alone would
 * hand the raise the step's refusal and defeat the reserve inside one tick.
 *
 * **Mutation:** `budget` dropped from the key → the `full` dispatch returns
 * `true` with `calls === 1`, red here and in no other case.
 */
export async function testTheBudgetIsPartOfTheKey(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = answering(true, false);

  const event = await memo.overLimit("c3-channel", "c3-org", "reserved", probe.read);
  const raise = await memo.overLimit("c3-channel", "c3-org", "full", probe.read);

  assert(event === true, `C3: the reserved budget is spent, got ${event}`);
  assert(raise === false, `C3: the raise still has the full ceiling, got ${raise}`);
  assert(
    probe.calls === 2,
    `C3: the full budget is a different key and is read for itself, got ${probe.calls}`,
  );
}

/**
 * C4 — the ORGANIZATION is part of the key.
 *
 * A channel id is a uuid and unique across the fleet, so on today's data this
 * segment can never disambiguate two rows — which is exactly why it has to be
 * asserted rather than assumed. `isOverHourlyLimit` filters on
 * `organization_id` as a residual predicate (Amendment 7 §1), so the ledger's
 * answer is a fact about the PAIR; a key that dropped the organization would
 * be a memo whose entries claim more than the read that produced them, and the
 * tenant-scoping mistakes this repository keeps finding are all of that shape.
 *
 * **Mutation:** `organizationId` dropped from the key → ORG_B returns `true`
 * with `calls === 1`, red here alone.
 */
export async function testTheOrganizationIsPartOfTheKey(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = answering(true, false);

  const orgA = await memo.overLimit("c4-channel", "c4-org-a", "reserved", probe.read);
  const orgB = await memo.overLimit("c4-channel", "c4-org-b", "reserved", probe.read);

  assert(orgA === true, `C4: ORG_A is over its ceiling, got ${orgA}`);
  assert(orgB === false, `C4: ORG_B is asked for itself, got ${orgB}`);
  assert(probe.calls === 2, `C4: a second organization is a second read, got ${probe.calls}`);
}

/**
 * C5 — the CHANNEL is part of the key.
 *
 * The ceiling is per channel: `ratePerHour` is a column on
 * `bms.notification_channels` and the read counts that channel's rows. One
 * refused webhook must not silence the email channel beside it, which is the
 * shape a step with three channels takes on every tick.
 *
 * **Mutation:** `channelId` dropped from the key → the second channel returns
 * `true` with `calls === 1`, red here alone.
 */
export async function testTheChannelIsPartOfTheKey(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = answering(true, false);

  const refused = await memo.overLimit("c5-channel-a", "c5-org", "reserved", probe.read);
  const other = await memo.overLimit("c5-channel-b", "c5-org", "reserved", probe.read);

  assert(refused === true, `C5: the first channel is over its ceiling, got ${refused}`);
  assert(other === false, `C5: the second channel is asked for itself, got ${other}`);
  assert(probe.calls === 2, `C5: a second channel is a second read, got ${probe.calls}`);
}

/**
 * C6 — a read that THREW is not an answer, and the memo remembers nothing.
 *
 * The rejection propagates unchanged, so the caller still sees the failure it
 * would see without a memo. Remembering it would be the worst entry in the set:
 * a database that cannot answer is not a channel over its ceiling, and one
 * transient failure would refuse every later dispatch on that key for the rest
 * of the sweep — silently, since the memo needs no reason to answer `true`.
 * `LostLedgerRows` accepts exactly that trade for a WRITE that failed and says
 * so at length; this class must not, because nothing here is a bound on
 * anything.
 *
 * The second call reads the same key and is answered `false`, so the case
 * measures the retry rather than a fresh key. `size` is deliberately NOT
 * asserted here: the retry's read count already says nothing was remembered,
 * and a `size` assertion in a case that is not about `size` would collect the
 * collateral of every mutation that touches the set — C1, C2 and C7 own that
 * measurement between them.
 *
 * **Mutation:** the read wrapped in a catch that remembers the key → the first
 * call resolves instead of rejecting and the second returns `true` with
 * `calls === 1`, red here alone.
 */
export async function testAThrownReadIsNotRemembered(): Promise<void> {
  const memo = new ClosedCeilings();
  const probe = failingThenAnswering(false);

  let propagated = "";
  try {
    await memo.overLimit("c6-channel", "c6-org", "reserved", probe.read);
  } catch (error) {
    propagated = error instanceof Error ? error.message : String(error);
  }
  assert(
    propagated === LEDGER_DOWN,
    `C6: the failed read propagates unchanged, got "${propagated}"`,
  );

  const retried = await memo.overLimit("c6-channel", "c6-org", "reserved", probe.read);
  assert(retried === false, `C6: the retry gets the ledger's own answer, got ${retried}`);
  assert(probe.calls === 2, `C6: a failure is not an answer, so it really asked again, got ${probe.calls}`);
}

/**
 * C7 — the memo is per instance: nothing lives at module level.
 *
 * Ruling 2 makes the window the sweep, so the memo has to be a thing the sweep
 * creates and drops. A module-level `Set` would be the same code with none of
 * that: it would outlive every tick, hold a refusal after the hour it was
 * measured in had passed, and need the TTL and the eviction cap ruling 2
 * declines to have — `F3.51` ruling 3 replaced a clock constant with a
 * structural condition and this keeps that.
 *
 * **The two instances close DIFFERENT keys, and that is load-bearing.** Closing
 * the same key in both would leave the module-level mutation undetectable: the
 * second instance would find the key already there, return `true` without
 * reading, and report `size === 1` — every assertion green with one shared set
 * behind them.
 *
 * **Mutation:** the `Set` moved to module level → both instances report one
 * shared count holding every key any earlier case closed (C1's, C3's, C4's,
 * C5's, then this case's two), red here. It also reddens C2, whose `size === 0`
 * a leaked C1 entry breaks; that collateral is a consequence of there being one
 * set, which is the defect itself.
 */
export async function testTheMemoIsPerInstance(): Promise<void> {
  const first = new ClosedCeilings();
  const second = new ClosedCeilings();
  const probe = answering(true);

  await first.overLimit("c7-channel-a", "c7-org", "reserved", probe.read);
  await second.overLimit("c7-channel-b", "c7-org", "reserved", probe.read);

  assert(first.size === 1, `C7: one sweep's memo holds only its own key, got ${first.size}`);
  assert(second.size === 1, `C7: and so does the other's, got ${second.size}`);
  assert(probe.calls === 2, `C7: neither instance answered from the other's memory, got ${probe.calls}`);
}
