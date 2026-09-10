import type { RuleChannelsRead } from "../notifications/channel-reads";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { attempt, freshMatching, retries } from "./alarm-lifecycle-raise-retry.spec";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
  NOW,
  ORG_B,
  alarmRow,
  assert,
  fakeDeps,
  ruleRow,
  twoStepCatalog,
} from "./alarm-lifecycle.service.spec";

/**
 * `F3.60` — the raise-retry phase reads every evidenced rule's channels in one
 * round trip (ADR 0041 Amendment 10, ADR 0057 Amendment 10).
 *
 * `runRaiseRetryPhase` called `loadRuleChannels(rule.id)` from inside the
 * candidate loop, memoised per rule for the tick. The memo collapsed the alarms
 * that shared a rule and nothing else, so the cost was one round trip per
 * distinct rule with an evidence-bearing alarm, every tick, serially. The phase
 * now applies both guards in a pre-pass, derives the distinct rule ids from the
 * candidates that survive it, and reads them in one call.
 *
 * **What these cases gate and what they cannot.** `fakeDeps` records the calls;
 * it holds no connection and applies no `WHERE`. So what is asserted here is
 * HOW MANY calls the phase makes and WHICH rules each one carries — never a
 * round trip or its cost. The round-trip saving was measured on the running
 * stack instead and is recorded in ADR 0041 Amendment 10, because no suite in
 * this repository can take that measurement.
 *
 * **`recorded.ruleChannelLoads` cannot hold R23's claim, and that is why
 * `ruleChannelReads` exists.** The flattened list is identical for a per-rule
 * read and for one batched read — it is the same rule ids in the same order —
 * so an assertion over it stays green under the mutation this row exists to
 * prevent. The per-call list is the only recording that separates them.
 *
 * The case numbers continue `alarm-lifecycle-raise-retry-evidence-guard.spec.ts`'s
 * sequence — R23 to R26 — because they are cases of the same phase and a reader
 * looking for R23 must not find two different ones.
 *
 * Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014). One `it()` per case, by `F4.105`.
 */

/** A `RuleChannelsRead` built by hand — the shape `deps.loadRuleChannels` returns. */
function read(
  byRule: Record<string, NotificationChannelRow[]>,
  unread: string[] = [],
  reasons: string[] = [],
): RuleChannelsRead<NotificationChannelRow> {
  return {
    byRule: new Map(Object.entries(byRule)),
    unread: new Set(unread),
    reasons,
  };
}

/** The alarm ids this tick re-offered a raise for, in order, as one string. */
function reoffered(recorded: Parameters<typeof retries>[0]): string {
  return retries(recorded)
    .map((entry) => entry.input.alarmId)
    .join(",");
}

/**
 * R23 — one batched read per tick, over the DISTINCT rules that have an
 * evidence-bearing alarm, and over no others.
 *
 * Four alarms on three rules: alarm-1 and alarm-2 share rule-1, alarm-3 is on
 * rule-2, and alarm-4 is on rule-3 with no ledger row at all. So the read must
 * carry `rule-1` and `rule-2` exactly once each and must not carry `rule-3`.
 *
 * The second assertion is the positive control. Asserting the call list alone
 * would pass against a phase that never dispatched anything — including one
 * that never ran — and this repository has been caught by that three times.
 */
export async function assertOneBatchedReadOverTheDistinctEvidencedRules(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-1" }),
      alarmRow({ id: "alarm-2", ruleId: "rule-1" }),
      alarmRow({ id: "alarm-3", ruleId: "rule-2" }),
      alarmRow({ id: "alarm-4", ruleId: "rule-3" }),
    ],
    rules: [
      ruleRow({ id: "rule-1", code: "RULE-1" }),
      ruleRow({ id: "rule-2", code: "RULE-2" }),
      ruleRow({ id: "rule-3", code: "RULE-3" }),
    ],
    sample: freshMatching,
    // alarm-4 holds none, so rule-3 never reaches the read.
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
      attempt(C1.id, "failed", { alarmId: "alarm-3" }),
    ],
    ruleChannels: () => [C1],
  });

  await runLifecycleSweep(deps, NOW);

  assert(
    JSON.stringify(recorded.ruleChannelReads) === '[["rule-1","rule-2"]]',
    `R23: one read carrying the two evidenced rules once each, got ${JSON.stringify(recorded.ruleChannelReads)}`,
  );
  assert(
    reoffered(recorded) === "alarm-1,alarm-2,alarm-3",
    `R23: the three evidenced alarms must still be re-offered, got ${reoffered(recorded)}`,
  );
}

/**
 * R24 — a rule whose batch did not return is decided about in no way, even when
 * a group came back for it.
 *
 * **The fixture is a shape `loadEnabledChannelsForRules` cannot produce, and
 * that is deliberate.** A failed batch adds all of its ids to `unread` and
 * contributes no group, and the batches are disjoint after de-duplication, so
 * no real read ever returns a rule in both. AGENTS.md §4.6 authorises the
 * synthetic input: where a rule is held is a claim about where its input
 * exists, and the claim here is about the phase's reading of the contract, not
 * about the reader.
 *
 * **What the guarded line buys in production today is nothing**, and the ADR
 * records that rather than hiding it: a rule whose batch threw has no group, so
 * the `?? []` and the `channels.length === 0` exit reach the same outcome one
 * line later. Deleting the skip leaves R25 green — this case is its only gate.
 * A later reader must not "fix" this fixture into a producible one: made
 * producible it becomes R25's, and the skip has no gate at all.
 */
export async function assertAnUnreadRuleIsDecidedAboutNothing(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-1" }),
      alarmRow({ id: "alarm-2", ruleId: "rule-2" }),
    ],
    rules: [ruleRow({ id: "rule-1", code: "RULE-1" }), ruleRow({ id: "rule-2", code: "RULE-2" })],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
    loadRuleChannels: () =>
      Promise.resolve(read({ "rule-1": [C1], "rule-2": [C1] }, ["rule-1"], ["batch reported failed"])),
  });

  await runLifecycleSweep(deps, NOW);

  assert(
    reoffered(recorded) === "alarm-2",
    `R24: only the alarm whose rule was read may be re-offered, got ${reoffered(recorded)}`,
  );
}

/**
 * R25 — a batch that did not return warns once, with counts and the cause, and
 * the phase carries on deciding every other rule.
 *
 * The fixture is the producible shape: two rules unread, contributing no group,
 * one reason. Six assertions, and the last is the positive control — a phase
 * that returned on a partial failure would satisfy the first five.
 *
 * Assertion 5 is §9.6: the alarm's own text (`alarmRow`'s "Feeder overload")
 * must never reach a log line.
 */
export async function assertAPartialFailureWarnsOnceAndCarriesOn(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-1" }),
      alarmRow({ id: "alarm-2", ruleId: "rule-2" }),
      alarmRow({ id: "alarm-3", ruleId: "rule-3" }),
    ],
    rules: [
      ruleRow({ id: "rule-1", code: "RULE-1" }),
      ruleRow({ id: "rule-2", code: "RULE-2" }),
      ruleRow({ id: "rule-3", code: "RULE-3" }),
    ],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
      attempt(C1.id, "failed", { alarmId: "alarm-3" }),
    ],
    loadRuleChannels: () =>
      Promise.resolve(read({ "rule-3": [C1] }, ["rule-1", "rule-2"], ["too many bind parameters"])),
  });

  await runLifecycleSweep(deps, NOW);

  const warning = recorded.warnings[0] ?? "";
  assert(recorded.warnings.length === 1, `R25: one warn line, got ${recorded.warnings.length}`);
  assert(warning.includes("2 of 3 rule(s)"), `R25: the counts must be in the line, got ${warning}`);
  assert(
    warning.includes("too many bind parameters"),
    `R25: the cause must be in the line, got ${warning}`,
  );
  assert(warning.includes("channel"), `R25: the line must say which read failed, got ${warning}`);
  assert(!warning.includes("Feeder overload"), `R25: §9.6 — no alarm text in a log line`);
  assert(
    reoffered(recorded) === "alarm-3",
    `R25: the rule that WAS read must still be decided, got ${reoffered(recorded)}`,
  );
}

/**
 * R26 — a rejected channel read warns and returns from the PHASE, not from the
 * sweep: the escalation phase still runs in the same tick.
 *
 * The twin at the end is what makes the absence a gate. Without it, "no retry"
 * would pass against a phase that never ran at all — the same fixture with a
 * working read re-offers, so the absence is attributable to the rejection.
 */
export async function assertARejectedReadStopsThePhaseAndNotTheTick(): Promise<void> {
  const fixture = {
    alarms: [alarmRow({ id: "alarm-1", ruleId: "rule-1" })],
    rules: [ruleRow({ id: "rule-1", code: "RULE-1" })],
    sample: freshMatching,
    catalog: twoStepCatalog(),
    raiseAttempts: [attempt(C1.id, "failed", { alarmId: "alarm-1" })],
  };
  const { deps, recorded } = fakeDeps({
    ...fixture,
    loadRuleChannels: () => Promise.reject(new Error("channels unreachable")),
  });

  await runLifecycleSweep(deps, NOW);

  assert(retries(recorded).length === 0, `R26: nothing may be re-offered when the read rejected`);
  const escalations = recorded.dispatches.filter((entry) => entry.input.reoffered !== true);
  assert(
    escalations.length === 1,
    `R26: the escalation phase must still run in the same tick, got ${escalations.length} dispatch(es)`,
  );
  const warning = recorded.warnings[0] ?? "";
  assert(recorded.warnings.length === 1, `R26: one warn line, got ${recorded.warnings.length}`);
  assert(
    warning.includes("channels unreachable"),
    `R26: the cause must be in the line, got ${warning}`,
  );
  assert(!warning.includes("Feeder overload"), `R26: §9.6 — no alarm text in a log line`);

  const twin = fakeDeps(fixture);
  await runLifecycleSweep(twin.deps, NOW);
  assert(
    retries(twin.recorded).length === 1,
    `R26: the same fixture with a working read must re-offer — got ${retries(twin.recorded).length}`,
  );
}

/**
 * R27 — the array the predicate is handed is the ORGANIZATION-FILTERED one.
 *
 * **This case exists because a mutation survived without it.** Replacing
 * `candidate.evidence` in the loop with a fresh `rowsByAlarm.get(...)` — the
 * same group, unfiltered — left every case in this repository green. R21 does
 * not reach it: its alarm's ONLY row is foreign, so the pre-pass drops the
 * alarm before the predicate is ever called, and the two readings agree. The
 * disagreement needs an alarm that holds BOTH, which is what this fixture is.
 *
 * The foreign row is `sent`, deliberately. `channelsOwedTheRaise` blocks on any
 * eligible row that is not `failed`, so an unfiltered read turns another
 * tenant's delivery into a reason to never retry this one — the failure is
 * silent, and it is a cross-tenant one.
 */
export async function assertThePredicateGetsTheOrganizationFilteredEvidence(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ id: "alarm-1", ruleId: "rule-1" })],
    rules: [ruleRow({ id: "rule-1", code: "RULE-1" })],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      // Another tenant's row under the same alarm id and channel. The ledger
      // read's three `IN` lists are independent, so it can reach the group.
      attempt(C1.id, "sent", { alarmId: "alarm-1", organizationId: ORG_B }),
    ],
    ruleChannels: () => [C1],
  });

  await runLifecycleSweep(deps, NOW);

  assert(
    reoffered(recorded) === "alarm-1",
    `R27: a foreign-organization row must not block the retry, got ${reoffered(recorded)}`,
  );
}

/**
 * R28 — a tick in which no candidate holds evidence makes no channel read at
 * all, not an empty one.
 *
 * **This case exists because a mutation survived without it.** Deleting the
 * `evidenced.length === 0` early return leaves every decision identical — the
 * id list is empty, `loadEnabledChannelsForRules` issues no statement for it
 * (case C5), and the loop has nothing to iterate. What it costs is one adapter
 * call per tick on the ordinary quiet fleet, and nothing asserted its absence.
 *
 * The twin is the positive control: the same shape WITH a ledger row makes
 * exactly one read, so the zero is attributable to the guard and not to a
 * sweep that never ran.
 */
export async function assertAnEvidencelessTickReadsNoChannels(): Promise<void> {
  const fixture = {
    alarms: [alarmRow({ id: "alarm-1", ruleId: "rule-1" })],
    rules: [ruleRow({ id: "rule-1", code: "RULE-1" })],
    sample: freshMatching,
    ruleChannels: () => [C1],
  };
  const { deps, recorded } = fakeDeps({ ...fixture, raiseAttempts: [] });

  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.ruleChannelReads.length === 0,
    `R28: no evidenced candidate must mean no channel read, got ${JSON.stringify(recorded.ruleChannelReads)}`,
  );

  const twin = fakeDeps({
    ...fixture,
    raiseAttempts: [attempt(C1.id, "failed", { alarmId: "alarm-1" })],
  });
  await runLifecycleSweep(twin.deps, NOW);
  assert(
    twin.recorded.ruleChannelReads.length === 1,
    `R28: the same fixture with evidence must make one read, got ${twin.recorded.ruleChannelReads.length}`,
  );
}
