import { ClosedCeilings } from "../notifications/closed-ceilings";
import type { DispatchOutcome } from "../notifications/dispatch-policy";
import { PROCESS_STARTED_AT } from "../notifications/notifications.config";
import type { DispatchInput } from "../notifications/notifications.service";
import type { RaiseAttemptRow } from "../notifications/raise-retry";
import {
  fakeDb,
  fakeTransport,
  serviceWith,
} from "../notifications/notifications.service.spec";
import { type EscalationCatalog, escalationKey } from "./alarm-lifecycle";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
  NOW,
  ORG_A,
  alarmRow,
  assert,
  fakeDeps,
  ruleRow,
  secondsBefore,
  twoStepCatalog,
} from "./alarm-lifecycle.service.spec";

/**
 * `F3.53` — the memo's LIFETIME, seen from the sweep that owns it (ADR 0041
 * Amendment 7, owner rulings 1 and 2).
 *
 * `closed-ceilings.spec.ts` holds the class and `dispatch-closed-ceilings.spec.ts`
 * holds the wiring inside `dispatchToChannel`. Neither can see the three claims
 * below, because all three are about WHO holds the instance and for how long:
 * one memo per tick, created by `runLifecycleSweep`, shared by the two
 * re-offering phases, dead when the tick ends, and never handed to the clear
 * phase's cleared message.
 *
 * **L1 is the only case in this repository that drives the real
 * `NotificationsService` from the real sweep.** Its `deps.dispatchToChannels`
 * is the service's own method rather than a recording fake, so the tick's memo
 * reaches the ledger read it was built for and the saving is counted in
 * `fakeDb().reads.rateLimit` — the same counter `dispatch-closed-ceilings.spec.ts`
 * uses one layer down. Everything else here is a fake-deps case, because
 * identity and absence need no database at all.
 *
 * **What no fake-deps case can gate, and this file does not pretend to.** The
 * production adapter in `alarm-lifecycle.service.ts` — the arrow that satisfies
 * `AlarmLifecycleDeps.dispatchToChannels` from the Nest class — is replaced by
 * every case in every sweep spec, this file included. Dropping its third
 * argument leaves all of them green. `alarm-lifecycle.integration.spec.ts`'s I1
 * is the one gate on it, and it needs a real database.
 *
 * **Every counter here is per fixture** (AGENTS.md §4.6): `fakeDb().reads` is
 * one fake's, `ClosedCeilings.size` is one instance's, and neither is a
 * lifetime statistic. A case that wants two windows makes two.
 *
 * **Every absence is paired with a positive on the same fixture.** L1's "one
 * ceiling read" rides beside `reads.deliveryExists === 2`, which says both
 * dispatches really entered `dispatchToChannel`; L3's "no memo" rides beside
 * the cleared dispatch having happened at all. An absence on its own passes
 * when the action never happens, which has cost this repository three times.
 *
 * One `it()` per case in the sibling `.test`: `assert` throws, so a shared
 * block would let a mutation redden an earlier case while the block that owns
 * the claim never runs.
 */

/** A matching sample keeps the clear phase inert: nothing stamps, nothing clears. */
const freshMatching = { time: secondsBefore(5), value: 150, unit: "kW" };

/** The sample that ends the hold: below the threshold, and fresh. */
const freshNonMatching = { time: secondsBefore(5), value: 50, unit: "kW" };

/** 120 s of normal, `DEFAULT_CLEAR_HOLD_SECONDS` exactly, so the fixture alarm clears this tick. */
const HOLD_STARTED = secondsBefore(120);

/** Every ceiling case runs at the default 60 an hour, where the reserved limit is 48. */
const RATE = "60";

/** What one wrapped `dispatchToChannels` call saw — the input, and the third argument. */
type SeenCall = { input: DispatchInput; memo: ClosedCeilings | undefined };

/**
 * Wraps the fixture's `dispatchToChannels` so every call records its THIRD
 * argument, and still delegates. The default fake is kept underneath rather
 * than replaced, so the phases see the outcomes they expect and nothing is
 * remembered as a lost row.
 */
function recordingDeps(deps: ReturnType<typeof fakeDeps>["deps"]): SeenCall[] {
  const seen: SeenCall[] = [];
  const inner = deps.dispatchToChannels.bind(deps);
  deps.dispatchToChannels = (channels, input, closedCeilings) => {
    seen.push({ input, memo: closedCeilings });
    return inner(channels, input, closedCeilings);
  };
  return seen;
}

/** One step at 1 minute to C1, mapped for a severity no other fixture alarm carries. */
function oneCriticalStep(): EscalationCatalog {
  return {
    defaults: new Map([
      [escalationKey(ORG_A, "critical"), [{ stepNo: 1, afterMinutes: 1, channelIds: [C1.id] }]],
    ]),
  };
}

/**
 * One `failed` ledger row under `alarm-1`'s raise key, on C1 — the evidence
 * `channelsOwedTheRaise` needs to call that channel still owed.
 *
 * `attemptedAt` is measured from `PROCESS_STARTED_AT`, never from the
 * fixture's `NOW`: `unconfiguredWatermark` is
 * `max(channel.updatedAt, PROCESS_STARTED_AT)` and the process boundary is the
 * later of the two here (`C1.updatedAt` is 2020), which is
 * `alarm-lifecycle-raise-retry.spec.ts`'s own reason for the same constant.
 */
const failedRaiseRow: RaiseAttemptRow = {
  alarmId: "alarm-1",
  organizationId: ORG_A,
  channelId: C1.id,
  status: "failed",
  attemptedAt: new Date(PROCESS_STARTED_AT.getTime() - 60_000),
};

/**
 * L1 — **the saving, end to end**: a tick's refused steps on one channel cost
 * ONE ceiling read, and the next tick asks again.
 *
 * Two alarms on one rule, one due step each, both to C1, and a ledger already
 * holding 60 `sent` rows against a ceiling of 60. `deps.dispatchToChannels` is
 * the real `NotificationsService` method, so the memo `runLifecycleSweep`
 * created reaches `isOverHourlyLimit` and the count in `reads.rateLimit` is the
 * production cost of the tick.
 *
 * **The two positives are what make this a saving rather than a short
 * circuit.** `reads.deliveryExists === 2` says both dispatches really entered
 * `dispatchToChannel` and each did its own event-idempotency read — without it,
 * "one ceiling read" would also pass if the second step were never dispatched.
 * `recorded.length === 0` is `F3.48` ruling Q1 unchanged: a ceiling-refused step
 * writes no row, which is exactly why the case spins and why Amendment 7 §1
 * measured this one and no other.
 *
 * **The second tick is the half that says the memo is not a cache.** A memo
 * hoisted to module scope, or held on `AlarmLifecycleService` beside
 * `lostLedgerRows`, would answer the second tick from the first tick's refusal
 * — and the trailing hour that produced that refusal has moved on by then.
 *
 * **Mutations:**
 * (a) `dispatchRememberingLostRows` passing no third argument — the shape the
 *     phases had before this unit — → tick 1 reads the ceiling twice, red on
 *     `reads.rateLimit === 1`;
 * (b) the memo hoisted to module scope in `alarm-lifecycle.service.ts`, or made
 *     an `AlarmLifecycleService` field → tick 2 answers from tick 1 and
 *     `reads.rateLimit` stays 1, red on the tick-2 assertion.
 */
export async function assertOneCeilingReadPerTickAndAgainNextTick(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = fakeTransport("webhook", () =>
    Promise.resolve({ status: "sent" as const, error: null }),
  );
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  setCount(60, 60);

  const { deps } = fakeDeps({
    alarms: [alarmRow(), alarmRow({ id: "alarm-2" })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });
  const outcomes: DispatchOutcome[][] = [];
  deps.dispatchToChannels = async (channels, input, closedCeilings) => {
    const result = await service.dispatchToChannels(channels, input, closedCeilings);
    outcomes.push(result);
    return result;
  };

  await runLifecycleSweep(deps, NOW);

  assert(outcomes.length === 2, `L1: one dispatch per alarm's due step, got ${outcomes.length}`);
  assert(
    outcomes.every((result) => result[0]?.status === "skipped_rate_limited"),
    `L1: both steps are refused by the ceiling, got [${outcomes
      .map((result) => String(result[0]?.status))
      .join(",")}]`,
  );
  assert(webhook.sent.length === 0, `L1: neither reached the transport, got ${webhook.sent.length}`);
  assert(
    recorded.length === 0,
    `L1: a ceiling-refused step still writes no row, got [${recorded.map((r) => r.status).join(",")}]`,
  );
  assert(
    reads.deliveryExists === 2,
    `L1: both dispatches really ran — two event-idempotency reads, got ${reads.deliveryExists}`,
  );
  assert(
    reads.rateLimit === 1,
    `L1: the tick's second refusal comes from the memo — one ceiling read, got ${reads.rateLimit}`,
  );

  await runLifecycleSweep(deps, NOW);

  assert(outcomes.length === 4, `L1: the second tick dispatches both steps again, got ${outcomes.length}`);
  assert(
    reads.rateLimit === 2,
    `L1: the next tick asks the ledger again — the memo died with the first, got ${reads.rateLimit}`,
  );
}

/**
 * L2 — **one memo per tick, shared by both re-offering phases, fresh every
 * tick.**
 *
 * One alarm owed its raise (a `failed` row on C1 under its raise key) and one
 * alarm with a due step, so the raise-retry phase and the escalation phase each
 * dispatch exactly once in the tick. The claim is object IDENTITY: the two
 * phases hold the same instance, and the next tick holds a different one.
 *
 * **Identity is the only honest gate here, and this is why.** `budgetFor` puts
 * a re-offered raise on the `full` budget and an escalation step on the
 * `reserved` one, and the budget is part of the memo's key — so the two phases
 * never share a key and a read count could never show them sharing an instance.
 * A case asserting "three reads become two across the phases" would be
 * asserting something the design forbids.
 *
 * **Mutations:**
 * (a) a memo constructed per phase — one inside `runRaiseRetryPhase` and one
 *     inside `runEscalationPhase` → the within-tick identity assertion reddens;
 * (b) one memo at module level, or on the service beside `lostLedgerRows` →
 *     the tick-to-tick inequality reddens.
 */
export async function assertOneMemoPerTickSharedByBothPhases(): Promise<void> {
  const { deps } = fakeDeps({
    alarms: [alarmRow(), alarmRow({ id: "alarm-2", severity: "critical" })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: oneCriticalStep(),
    raiseAttempts: [failedRaiseRow],
  });
  const seen = recordingDeps(deps);

  await runLifecycleSweep(deps, NOW);

  const firstTick = [...seen];
  assert(firstTick.length === 2, `L2: one raise retry and one step in the tick, got ${firstTick.length}`);
  const retry = firstTick.find((call) => call.input.reoffered === true);
  const step = firstTick.find((call) => call.input.event?.kind === "escalation");
  assert(retry !== undefined, "L2: the raise-retry phase dispatched");
  assert(step !== undefined, "L2: the escalation phase dispatched");
  if (!retry || !step) return;
  assert(
    retry.memo instanceof ClosedCeilings,
    `L2: the raise retry is handed a ClosedCeilings, got ${String(retry.memo)}`,
  );
  assert(
    step.memo instanceof ClosedCeilings,
    `L2: so is the escalation step, got ${String(step.memo)}`,
  );
  assert(retry.memo === step.memo, "L2: and it is the SAME instance — one memo per tick, not per phase");

  await runLifecycleSweep(deps, NOW);

  const secondTick = seen.slice(2);
  assert(secondTick.length === 2, `L2: the second tick dispatches both again, got ${secondTick.length}`);
  const laterRetry = secondTick.find((call) => call.input.reoffered === true);
  const laterStep = secondTick.find((call) => call.input.event?.kind === "escalation");
  assert(laterRetry !== undefined && laterStep !== undefined, "L2: both phases ran on the second tick");
  if (!laterRetry || !laterStep) return;
  assert(
    laterRetry.memo === laterStep.memo,
    "L2: the second tick's phases share one instance too",
  );
  assert(
    laterRetry.memo !== retry.memo,
    "L2: and it is NOT the first tick's — the memo dies with the sweep that made it",
  );
}

/**
 * L3 — **the cleared message is never handed a memo** (Amendment 7 ruling 2,
 * second bullet).
 *
 * A cleared message is dispatched once, from the clear phase, and
 * `loadActiveAlarms` never selects that alarm again. It has no next tick to be
 * postponed to, so `ClosedCeilings`'s non-monotone edge — a channel at its
 * limit that drops below it part-way through the tick — would cost the clear
 * itself rather than 30 s of latency. That is the silent-loss shape ADR 0057
 * Amendment 2 ruling Q-A refused.
 *
 * The absence is paired with its positive on the same fixture: `sentChannelIds`
 * names C1, so `notifyCleared` passes both of its reads and really dispatches.
 * Without that, "no memo" would pass on a clear that never told anybody.
 *
 * **Mutation:** threading the memo into `ClearPhaseInput` and passing it at
 * `notifyCleared`'s `dispatchToChannels` — the edit a reader who saw the two
 * phases get one would make — → the third argument is a `ClosedCeilings`, red
 * here. No other case in this repository reddens on it.
 */
export async function assertTheClearedMessageIsHandedNoMemo(): Promise<void> {
  const { deps } = fakeDeps({
    alarms: [alarmRow({ normalSince: HOLD_STARTED })],
    rules: [ruleRow()],
    sample: freshNonMatching,
    sentChannelIds: [C1.id],
  });
  const seen = recordingDeps(deps);

  await runLifecycleSweep(deps, NOW);

  const cleared = seen.filter((call) => call.input.event?.kind === "cleared");
  assert(
    cleared.length === 1,
    `L3: the cleared message was dispatched — the positive this absence needs, got ${cleared.length}`,
  );
  assert(
    cleared[0]?.memo === undefined,
    `L3: and it carries no memo, got ${String(cleared[0]?.memo?.constructor.name)}`,
  );
}
