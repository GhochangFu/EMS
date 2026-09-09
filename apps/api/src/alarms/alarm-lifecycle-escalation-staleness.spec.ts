import { type EscalationCatalog, escalationKey } from "./alarm-lifecycle";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
  C2,
  NOW,
  ORG_A,
  type Recorded,
  alarmRow,
  assert,
  fakeDeps,
  ruleRow,
  secondsBefore,
} from "./alarm-lifecycle.service.spec";

/**
 * `F3.52` — the escalation phase decides an age per step, every tick (ADR 0041
 * Amendment 6 §2, ADR 0057 Amendment 7).
 *
 * `alarm-lifecycle.spec.ts` holds `stepIsTooLate` itself, as a pure function.
 * This file holds the WIRING: that `runEscalationPhase` computes the age from
 * the step it is about to dispatch and hands the answer to
 * `escalationDispatchInput`. A phase that passed a literal `false` there would
 * leave every pure-function case green and the whole cut-off inert — the
 * required fifth parameter makes forgetting it a compile error, not a silent
 * one, and S2 below is what makes passing the wrong constant a red one.
 *
 * **Its own file, and the reason is the cap.**
 * `alarm-lifecycle.service.spec.ts` stands near AGENTS.md §4.5's margin and
 * `alarm-lifecycle-raise-retry.spec.ts` with it; §2's instruction for a file at
 * that margin is to extract before adding. The fixture is imported from the
 * first of those, the shape `alarm-lifecycle-escalation-lost-rows.spec.ts`
 * already uses — with one exported function and one `it()` per case, because
 * `assert` throws and a shared `it()` would let a mutation redden an earlier
 * case while the case owning the claim never ran.
 *
 * **What is asserted here is the INPUT, not the ledger row.** The row is
 * `dispatchToChannel`'s to write and `dispatch-staleness.spec.ts` holds it.
 * The seam between the two is `input.event.stale`, so that is what these cases
 * read.
 */

/** The default bound the phase imports: 60 minutes. Every fixture below is placed either side of it. */
const BOUND_MINUTES = 60;

/** A matching sample keeps the clear phase inert: nothing stamps, nothing clears. */
const freshMatching = { time: secondsBefore(5), value: 150, unit: "kW" };

/** One due step at `afterMinutes`, to C1. */
function oneStep(afterMinutes: number): EscalationCatalog {
  return {
    defaults: new Map([
      [escalationKey(ORG_A, "warning"), [{ stepNo: 1, afterMinutes, channelIds: [C1.id] }]],
    ]),
  };
}

/**
 * An alarm whose step at `afterMinutes` came due `lateMinutes` ago: the raise
 * is `afterMinutes + lateMinutes` in the past, which is the arithmetic
 * `stepIsTooLate` inverts.
 */
function alarmDueMinutesAgo(afterMinutes: number, lateMinutes: number): ReturnType<typeof alarmRow> {
  return alarmRow({ raisedAt: secondsBefore((afterMinutes + lateMinutes) * 60) });
}

/** The escalation dispatches only — a raise retry or a cleared message shares the list. */
function steps(recorded: Recorded): Recorded["dispatches"] {
  return recorded.dispatches.filter((entry) => entry.input.event?.kind === "escalation");
}

/** The `stale` property of the nth escalation dispatch's event, or the reason it cannot be read. */
function staleOf(recorded: Recorded, index: number): boolean | string {
  const event = steps(recorded)[index]?.input.event;
  if (event === undefined || event.kind !== "escalation") {
    return `no escalation dispatch at index ${index}`;
  }
  return event.stale === true;
}

/** One tick over one alarm with one due step. */
async function sweepOneStep(
  afterMinutes: number,
  lateMinutes: number,
): Promise<{ recorded: Recorded }> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmDueMinutesAgo(afterMinutes, lateMinutes)],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: oneStep(afterMinutes),
  });
  await runLifecycleSweep(deps, NOW);
  return { recorded };
}

/**
 * S1 — a step ten minutes past due carries NO flag.
 *
 * The absence is the whole claim: a due step is late long before it is stale,
 * and the sweep re-offers a ceiling-refused step every 30 s, so most flagged
 * steps would be steps the ceiling was about to let through.
 *
 * **Mutation:** the phase marking every due step (`true` passed as the fifth
 * argument, or the predicate inverted at the call) → red here, and S2 green.
 */
export async function testAStepTenMinutesLateIsNotFlagged(): Promise<void> {
  const { recorded } = await sweepOneStep(1, 10);
  assert(steps(recorded).length === 1, `the step is dispatched, got ${steps(recorded).length}`);
  assert(
    staleOf(recorded, 0) === false,
    `ten minutes past due is late, not stale, got ${String(staleOf(recorded, 0))}`,
  );
}

/**
 * S2 — a step 61 minutes past due carries the flag.
 *
 * **Mutation:** the phase never computing staleness — a literal `false` at the
 * call site, which the required fifth parameter still permits — → red here, and
 * S1 green. This is the pair S1 cannot make on its own.
 */
export async function testAStepPastTheBoundIsFlagged(): Promise<void> {
  const { recorded } = await sweepOneStep(1, BOUND_MINUTES + 1);
  assert(
    staleOf(recorded, 0) === true,
    `61 minutes past due is stale, got ${String(staleOf(recorded, 0))}`,
  );
}

/**
 * S3 — and it is still DISPATCHED.
 *
 * The phase does not `continue` past a stale step. The row is written by the
 * path that writes every other refusal, so a phase that skipped would produce
 * no send, no row and no evidence — the silent-loss shape `F3.48`, `F3.54` and
 * `F3.55` were each filed to remove.
 *
 * **Mutation:** `continue` before the dispatch → red here. Honestly reported:
 * it reddens S2 as well, because S2 reads the same dispatch on the same
 * fixture. No fixture separates them — "it is marked" and "it still happens"
 * are two readings of one observation — and contorting one to force a
 * one-to-one measurement would only hide that.
 */
export async function testAStaleStepIsStillDispatched(): Promise<void> {
  const { recorded } = await sweepOneStep(1, BOUND_MINUTES + 1);
  const sent = steps(recorded);
  assert(sent.length === 1, `the stale step is still dispatched, got ${sent.length} dispatch(es)`);
  assert(
    (sent[0]?.channels ?? []).map((channel) => channel.code).join(",") === "c1",
    `to its own channels, unchanged, got [${(sent[0]?.channels ?? [])
      .map((channel) => channel.code)
      .join(",")}]`,
  );
}

/**
 * S4 — two steps, one alarm, one tick: only the stale one carries the flag.
 *
 * Seventy minutes after the raise, step 1 (due at one minute) is 69 minutes
 * late and step 2 (due at 65 minutes) is five. One `raised_at`, two answers.
 *
 * **Mutation:** staleness computed once per ALARM rather than per step — from
 * `now - alarm.raisedAt`, the mistake the pure-function case
 * `testLatenessIsMeasuredFromTheDueInstant` describes — → both steps flagged,
 * so the second half reddens. Every other case in this file has one step and
 * would stay green.
 */
export async function testStalenessIsPerStepNotPerAlarm(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(70 * 60) })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: {
      defaults: new Map([
        [
          escalationKey(ORG_A, "warning"),
          [
            { stepNo: 1, afterMinutes: 1, channelIds: [C1.id] },
            { stepNo: 2, afterMinutes: 65, channelIds: [C2.id] },
          ],
        ],
      ]),
    },
  });

  await runLifecycleSweep(deps, NOW);

  const sent = steps(recorded);
  assert(sent.length === 2, `both steps are due and dispatched, got ${sent.length}`);
  assert(
    sent[0]?.input.event?.kind === "escalation" && sent[0].input.event.step === 1,
    "the first dispatch is step 1 — dueSteps sorts ascending",
  );
  assert(
    staleOf(recorded, 0) === true,
    `step 1 is 69 minutes past ITS due instant, got ${String(staleOf(recorded, 0))}`,
  );
  assert(
    staleOf(recorded, 1) === false,
    `step 2 is five minutes past ITS own, on the same alarm, got ${String(staleOf(recorded, 1))}`,
  );
}
