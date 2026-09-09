import { buildDedupeKey } from "./dedupe-key";
import { EVENT_SHARE, RESERVED_KEY_PATTERN, budgetFor, hourlyCeiling } from "./dispatch-policy";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.52` — the two limits ADR 0041 Amendment 6 §1 puts behind decision 7's
 * single count (owner rulings 3 and 4).
 *
 * `isOverHourlyLimit` runs ONE query. What Amendment 6 added is a second limit
 * over it: the raise path keeps the whole `ratePerHour`, and the event path — an
 * escalation step or a cleared message — stops at
 * `Math.floor(ratePerHour * EVENT_SHARE)`, so the last slots of every hour stay
 * reachable by a raise alone.
 *
 * **Owner ruling 8 gave the second limit its own number** to be compared
 * against: the query returns the trailing hour's `sent` rows AND the subset of
 * them written by dispatches that charged the reserved budget, so a backlog of
 * raises can no longer spend the event share. The pure half of that ruling is
 * {@link RESERVED_KEY_PATTERN} and the key shape it depends on, which is the
 * last case in this file; the wiring half is `dispatch-budget.spec.ts`.
 *
 * **One exported function per claim, and one `it()` per function** in the
 * sibling `.test.ts`. `assert` throws, so a suite that puts every claim in one
 * `it()` reddens at the FIRST failing block and never runs the block that owns
 * the claim — the shape this repository has been burned by (AGENTS.md §4.6: a
 * mutation must redden THAT assertion). Every case below names the mutations it
 * kills, and each of those names the one case that kills it.
 *
 * The service-level half of the same rulings — which budget each of the three
 * call sites asks for — is `dispatch-budget.spec.ts`. Nothing here touches a
 * database or a service; these are pure functions of their arguments.
 */

/**
 * The raise path keeps the whole ceiling.
 *
 * **Mutation:** apply the reserve to the raise path as well (return
 * `Math.floor(ratePerHour * EVENT_SHARE)` for both budgets) → 48, red here and
 * nowhere else in this file.
 */
export function testTheRaisePathKeepsTheWholeCeiling(): void {
  assert(
    hourlyCeiling("full", 60) === 60,
    `the full budget is the configured rate untouched, got ${hourlyCeiling("full", 60)}`,
  );
}

/**
 * The event path stops four fifths of the way up.
 *
 * At the default 60 an hour, events stop at 48 and twelve slots stay reachable
 * by a raise alone — Amendment 6 §1's worked example, asserted rather than
 * quoted.
 *
 * **Mutation:** `EVENT_SHARE` changed from `0.8` to any other share (`0.5` →
 * 30, `1.0` → 60) → red here.
 */
export function testTheEventPathStopsAtFourFifthsOfTheCeiling(): void {
  assert(
    hourlyCeiling("reserved", 60) === 48,
    `the reserved budget is four fifths of 60, got ${hourlyCeiling("reserved", 60)}`,
  );
  // Pinned beside it, because the number above is only readable against it:
  // a reader who finds 48 here and 0.8 there must not have to multiply.
  assert(EVENT_SHARE === 0.8, `EVENT_SHARE is the share Amendment 6 ruled, got ${EVENT_SHARE}`);
}

/**
 * The accepted consequence at the extreme, and the ONLY fixture in this
 * repository that separates `Math.floor` from `Math.ceil` or `Math.round`.
 *
 * Amendment 6 §1 states it at this gate on purpose: `Math.floor(1 * 0.8)` is
 * `0`, so a channel throttled to one message an hour sends raises only — no
 * escalation step and no cleared message at all. That is the correct ordering
 * of the two, and it is a behaviour change, so it is covered rather than
 * assumed.
 *
 * **Mutation:** `Math.floor` → `Math.ceil` (1) or `Math.round` (1) → red here.
 * Every other fixture in this file lands on an exact integer product, where
 * the three functions agree.
 */
export function testAReservedCeilingRoundsDownToZeroAtARateOfOne(): void {
  assert(
    hourlyCeiling("reserved", 1) === 0,
    `floor(1 x 0.8) is 0, not a rounded 1 — got ${hourlyCeiling("reserved", 1)}`,
  );
  // The paired positive on the same rate: the raise still gets its one slot,
  // so a mutation that returned 0 for everything is not what passed the line
  // above.
  assert(
    hourlyCeiling("full", 1) === 1,
    `a raise still reaches the single slot, got ${hourlyCeiling("full", 1)}`,
  );
}

/**
 * A dispatch with no event is the raise path, and the raise path is full.
 *
 * **Mutation:** the discriminator inverted (`input.event === undefined ?
 * "reserved" : "full"`) → red here AND in the three cases below, which is what
 * makes those three separate claims rather than restatements of this one.
 */
export function testADispatchWithNoEventIsTheFullBudget(): void {
  assert(budgetFor({}) === "full", `no event is the raise path, got ${budgetFor({})}`);
}

/**
 * An escalation step is on the reserved budget.
 *
 * **Mutation:** the escalation arm dropped — anything that answers `"full"`
 * for a step (`input.event?.kind === "cleared" ? "reserved" : "full"`) → red
 * here and green in every other case in this file.
 */
export function testAnEscalationStepIsOnTheReservedBudget(): void {
  const budget = budgetFor({ event: { kind: "escalation", step: 1 } });
  assert(budget === "reserved", `a step is an event and stops at the reserve, got ${budget}`);
}

/**
 * A cleared message is on the reserved budget too.
 *
 * Amendment 6 §1 says "an escalation step or a cleared message", and the
 * discriminator is the presence of an event rather than its kind, so this is
 * the case that stops the clear being left on the full budget by a reading
 * that saw only the word "escalation".
 *
 * **Mutation:** `input.event?.kind === "escalation" ? "reserved" : "full"` →
 * red here and green everywhere else.
 */
export function testAClearedMessageIsOnTheReservedBudgetToo(): void {
  const budget = budgetFor({ event: { kind: "cleared" } });
  assert(budget === "reserved", `a clear is an event and stops at the reserve, got ${budget}`);
}

/**
 * A RE-OFFERED raise keeps the full budget, and this is the case that separates
 * `budgetFor` from `offeredAgainWithoutAsking` in the same file.
 *
 * The two read the same structural shape and disagree on `reoffered` on
 * purpose: `offeredAgainWithoutAsking` answers whether a refusal is RECORDED,
 * and a re-offered raise is silent there because the sweep will ask again
 * (ADR 0041 Amendment 5). `budgetFor` answers which CEILING applies, and a
 * re-offered raise is still a raise — it is the very message Amendment 6
 * reserves the headroom for, so demoting it would defeat the reserve at the
 * one dispatch that needs it.
 *
 * **Mutation:** `budgetFor` delegating to `offeredAgainWithoutAsking`, or any
 * arm reading `reoffered` → `"reserved"`, red here alone.
 */
export function testAReofferedRaiseKeepsTheFullBudget(): void {
  const budget = budgetFor({ reoffered: true });
  assert(budget === "full", `a re-offered raise is still a raise, got ${budget}`);
}

/**
 * Owner ruling 8's pure half: an EVENT key carries a segment a raise key does
 * not, and {@link RESERVED_KEY_PATTERN} asks for exactly that segment.
 *
 * The reserved count must match the rows written by dispatches that CHARGED the
 * reserved budget — every event, because {@link budgetFor} answers `"reserved"`
 * for every event, and a test send, which writes no key at all. The ledger has
 * no column saying which budget a row charged, so the key shape is what the
 * `FILTER` reads, and this case is what pins that shape: a raise key is
 * `rule:alarm:severity` and every event key appends to it.
 *
 * The pattern needs one colon MORE than a raise key has, which is the same
 * number as a raise key's segments — so `LIKE '%:%:%:%'` matches an escalation
 * key and a cleared key and never a bare raise key. Stated as that relation
 * rather than as the literal, because the literal alone would be a restatement
 * of the constant.
 *
 * **Mutations:** the pattern shortened to `'%:%:%'` → red here, and a raise row
 * would then fill the reserve — the defect ruling 8 removed, arriving from the
 * SQL side. A suffix moved to the FRONT of the key in `buildDedupeKey` (the
 * "escalation:1:rule:alarm:severity" shape) leaves the counts intact and is not
 * killed here; nothing else about it would work either, and `dedupe-key.spec.ts`
 * holds the prefix rule.
 *
 * **What this does NOT gate:** LIKE's own semantics. No case in this repository
 * runs the pattern over a string in TypeScript, because a matcher written here
 * would only agree with itself. `storm-control.integration.spec.ts` is where the
 * `WHERE` clauses of this service meet real rows; it RAN green against Postgres
 * with the new aggregate, so the statement is valid SQL and the ceiling read
 * executes — but this unit added no case there, so WHICH rows the pattern
 * selects is still unmeasured against a database.
 */
export function testAnEventKeyCarriesTheSegmentTheReservedFilterAsksFor(): void {
  const raise = { ruleId: "rule-1", alarmId: "alarm-1", severity: "critical" };
  const segments = (key: string): number => key.split(":").length;

  assert(
    segments(buildDedupeKey(raise)) === 3,
    `a raise key is rule:alarm:severity, got ${buildDedupeKey(raise)}`,
  );
  assert(
    segments(buildDedupeKey({ ...raise, event: { kind: "escalation", step: 1 } })) === 5,
    `a step key appends :escalation:<n>, got ${buildDedupeKey({
      ...raise,
      event: { kind: "escalation", step: 1 },
    })}`,
  );
  assert(
    segments(buildDedupeKey({ ...raise, event: { kind: "cleared" } })) === 4,
    `a cleared key appends :cleared, got ${buildDedupeKey({
      ...raise,
      event: { kind: "cleared" },
    })}`,
  );
  assert(
    RESERVED_KEY_PATTERN.split(":").length - 1 === segments(buildDedupeKey(raise)),
    `the pattern must demand one colon more than a raise key has, got ${RESERVED_KEY_PATTERN}`,
  );
}
