import { buildDedupeKey } from "../notifications/dedupe-key";
import { LostLedgerRows } from "../notifications/raise-retry";
import { type EscalationCatalog, escalationDispatchInput, escalationKey } from "./alarm-lifecycle";
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
 * `F3.51` second review (High) — the ESCALATION phase's lost-row accounting.
 *
 * The first review closed this hole on the raise path only.
 * `runEscalationPhase` discarded `dispatchToChannels`'s outcomes, so `rowLost`
 * had no consumer there: with a ledger that serves reads and refuses inserts,
 * `eventDeliveryBlocked` finds no row under the step's key and never blocks,
 * `isOverHourlyLimit` counts no `sent` rows, and the due step is re-sent on
 * every 30 s tick for the life of the alarm with no ledger trace of any of it.
 * That is the same defect `LostLedgerRows` was built for, in the phase that ran
 * directly after the one it was wired into.
 *
 * **Its own file, and the reason is the cap.** `alarm-lifecycle.service.spec.ts`
 * (the escalation cases' home) stands at 801 of AGENTS.md §4.5's 1000 lines and
 * `alarm-lifecycle-raise-retry.spec.ts` at 888; §2's instruction for a file at
 * that margin is to extract before adding. The fixture is imported from the
 * first of those, the shape `alarm-lifecycle-raise-retry.spec.ts` already uses.
 *
 * **What no other suite holds.** The raise-retry cases (R17–R19) drive the same
 * class through the same `deps.lostLedgerRows`, and every one of them passes
 * with the escalation phase unwired — their fixtures map no escalation profile,
 * so no step is ever due. E1 below is the case that separates the two
 * accountings: a memory filled with the alarm's RAISE key must not silence its
 * escalation step, which is what a wiring that reused the raise key (the
 * candidate ref is right there in the sibling phase) would do.
 *
 * **Every absence is paired with a positive on the same fixture** — E1 offers
 * the step under the raise key and withholds it under the step's own, E2
 * withholds C1 while C2 still goes, E3's refused pair is re-offered. An
 * absence alone passes when the action never happens at all.
 */

/** `alarmRow`'s `raisedAt` is 61 s before `NOW`, so a 1-minute step is due and a 5-minute one is not. */
const DUE_AFTER_MINUTES = 1;

/** The raise key of the fixture alarm — `rule:alarm:severity`, no event suffix. */
const RAISE_KEY = "rule-1:alarm-1:warning";

/**
 * The due step's own key, built the way the phase builds it rather than
 * written out: `escalationDispatchInput` is what production passes to
 * `dispatchToChannels`, and `buildDedupeKey` is what that method calls. The
 * literal is asserted beside it so a reader can see the two keys differ by more
 * than a variable name.
 */
const STEP_KEY = buildDedupeKey(
  escalationDispatchInput(alarmRow(), ruleRow(), 1, NOW) ?? { ruleId: "", alarmId: null, severity: null },
);

/** One due step at 1 minute, naming BOTH channels — so one channel can be lost while the other lands. */
function oneStepBothChannels(): EscalationCatalog {
  return {
    defaults: new Map([
      [
        escalationKey(ORG_A, "warning"),
        [{ stepNo: 1, afterMinutes: DUE_AFTER_MINUTES, channelIds: [C1.id, C2.id] }],
      ],
    ]),
  };
}

/** A matching sample keeps the clear phase inert: nothing stamps, nothing clears, nothing is deducted. */
const freshMatching = { time: secondsBefore(5), value: 150, unit: "kW" };

/** The escalation dispatches only — a raise retry or a cleared message shares the list. */
function steps(recorded: Recorded): Recorded["dispatches"] {
  return recorded.dispatches.filter((entry) => entry.input.event?.kind === "escalation");
}

function channelCodes(entry: Recorded["dispatches"][number] | undefined): string {
  return (entry?.channels ?? []).map((channel) => channel.code).join(",");
}

/** The fixture every case below drives: one alarm, one due step, both channels. */
function escalatingDeps(lostLedgerRows: LostLedgerRows): ReturnType<typeof fakeDeps> {
  return fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: oneStepBothChannels(),
    lostLedgerRows,
  });
}

/**
 * E1 — the two accountings are separate, and the key is what separates them.
 *
 * A memory holding the alarm's RAISE key must not silence its escalation step:
 * a lost raise row says nothing about whether the step's row can be written,
 * and the ledger reads that bound each are filtered on their own key
 * (`channelsOwedTheRaise` on the raise key, `eventDeliveryBlocked` on the
 * step's). Holding the STEP's key must silence it.
 *
 * **Mutation:** keying the escalation filter on the raise key — the candidate
 * ref is in the sibling phase, so it is the mistake to expect — reddens the
 * first half. Not filtering at all reddens the second.
 */
async function testTheStepKeyIsNotTheRaiseKey(): Promise<void> {
  assert(
    STEP_KEY === `${RAISE_KEY}:escalation:1`,
    `the step's key carries the event suffix, got "${STEP_KEY}"`,
  );

  {
    const memory = new LostLedgerRows();
    memory.add("alarm-1", C1.id, RAISE_KEY);
    memory.add("alarm-1", C2.id, RAISE_KEY);
    const { deps, recorded } = escalatingDeps(memory);
    await runLifecycleSweep(deps, NOW);

    const sent = steps(recorded);
    assert(sent.length === 1, `the step is still dispatched, got ${sent.length} dispatches`);
    assert(
      channelCodes(sent[0]) === "c1,c2",
      `a lost RAISE row silences no step, got [${channelCodes(sent[0])}]`,
    );
  }

  {
    const memory = new LostLedgerRows();
    memory.add("alarm-1", C1.id, STEP_KEY);
    const { deps, recorded } = escalatingDeps(memory);
    await runLifecycleSweep(deps, NOW);

    const sent = steps(recorded);
    assert(sent.length === 1, `the step still goes to the other channel, got ${sent.length}`);
    assert(
      channelCodes(sent[0]) === "c2",
      `the channel whose step row was lost is dropped, got [${channelCodes(sent[0])}]`,
    );
  }
}

/**
 * E2 — a step whose delivery row did not land is not re-offered, and the
 * channel whose row landed still is.
 *
 * This is the defect itself. `dispatchToChannels` is wrapped so C1's outcome
 * reports `rowLost: true` and C2's does not, which is exactly what `record()`
 * returns when one insert throws and the other commits.
 *
 * **Mutation:** discarding the outcomes (the code before this fix) → the second
 * tick offers `c1,c2` again and the second assertion reddens. Remembering every
 * outcome rather than the lost ones → the first assertion of the second tick
 * reddens, because C2 would be dropped too.
 */
async function testALostStepRowStopsTheReoffer(): Promise<void> {
  const memory = new LostLedgerRows();
  const { deps, recorded } = escalatingDeps(memory);
  const inner = deps.dispatchToChannels.bind(deps);
  deps.dispatchToChannels = async (channels, input) => {
    const outcomes = await inner(channels, input);
    return outcomes.map((outcome) =>
      outcome.channelId === C1.id ? { ...outcome, rowLost: true } : outcome,
    );
  };

  await runLifecycleSweep(deps, NOW);
  await runLifecycleSweep(deps, NOW);

  const sent = steps(recorded);
  assert(sent.length === 2, `one dispatch per tick, got ${sent.length}`);
  assert(
    channelCodes(sent[0]) === "c1,c2",
    `the first tick offers both, got [${channelCodes(sent[0])}]`,
  );
  assert(
    channelCodes(sent[1]) === "c2",
    `the second offers only the channel whose row landed, got [${channelCodes(sent[1])}]`,
  );
  assert(
    memory.has("alarm-1", C1.id, STEP_KEY) && !memory.has("alarm-1", C2.id, STEP_KEY),
    "the memory holds the lost pair under the STEP's key, and only that pair",
  );
  assert(
    !memory.has("alarm-1", C1.id, RAISE_KEY),
    "and never under the raise key — the raise-retry phase reads that one",
  );
}

/**
 * E3 — at the cap the escalation phase says so, once per tick, and the refused
 * pair falls back to being re-offered.
 *
 * The warn names its own phase. The raise-retry phase writes a line of the same
 * shape from the same cap, and an operator reading "the memory is full" needs
 * to know which accounting stopped remembering; `alarm-lifecycle-raise-retry`
 * R19 filters on the raise-retry wording for the same reason.
 *
 * **Mutation:** dropping the warn → red on the count. Evicting to make room
 * rather than refusing → the pre-filled raise entry would be gone, so
 * `capWarnings.length` falls to 0 and the first assertion reddens too.
 */
async function testTheCapIsReportedByTheEscalationPhase(): Promise<void> {
  const memory = new LostLedgerRows(1);
  // The one slot the cap allows is spent on an entry of the OTHER accounting,
  // for an alarm that is still active — `retainAlarms` would free it otherwise
  // and the cap would never be reached.
  memory.add("alarm-1", C2.id, RAISE_KEY);

  const { deps, recorded } = escalatingDeps(memory);
  const inner = deps.dispatchToChannels.bind(deps);
  deps.dispatchToChannels = async (channels, input) => {
    const outcomes = await inner(channels, input);
    return outcomes.map((outcome) => ({ ...outcome, rowLost: true }));
  };

  await runLifecycleSweep(deps, NOW);
  await runLifecycleSweep(deps, NOW);

  const sent = steps(recorded);
  assert(
    sent.length === 2 && channelCodes(sent[1]) === "c1,c2",
    `a pair the cap refused is re-offered on the next tick, got ${sent.length} dispatch(es) [${channelCodes(sent[1])}]`,
  );
  const capWarnings = recorded.warnings.filter((line) =>
    line.includes("escalation lost-row memory is full"),
  );
  assert(
    capWarnings.length === 2,
    `one warn per tick, not one per pair, got ${JSON.stringify(recorded.warnings)}`,
  );
  const warning = capWarnings[0] ?? "";
  assert(
    warning.includes("1 entries") && warning.includes("2 further lost row"),
    `the warn carries the cap and the count, got "${warning}"`,
  );
  assert(!warning.includes("alarm-1"), "§9.6: and no ids — the cap is a fleet state, not an alarm's");
  assert(!warning.includes("Feeder overload"), "§9.6: and no alarm text");
}

export async function runEscalationLostRowTests(): Promise<void> {
  await testTheStepKeyIsNotTheRaiseKey();
  await testALostStepRowStopsTheReoffer();
  await testTheCapIsReportedByTheEscalationPhase();
}
