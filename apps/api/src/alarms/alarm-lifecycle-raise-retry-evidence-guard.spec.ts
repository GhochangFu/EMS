import { attempt, freshMatching, retries } from "./alarm-lifecycle-raise-retry.spec";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import { C1, NOW, ORG_B, alarmRow, assert, fakeDeps, ruleRow } from "./alarm-lifecycle.service.spec";

/**
 * `F3.59` — the raise-retry phase reads a rule's channels only for an alarm
 * that holds a ledger row under its raise key (ADR 0057 Amendment 9).
 * Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014).
 *
 * `runRaiseRetryPhase` paid `loadRuleChannels(candidate.rule.id)` before it
 * knew whether the alarm held any row. `channelsOwedTheRaise` returns `[]` for
 * ANY channel list when its `rows` argument is empty — stage 1, owner ruling 3
 * of ADR 0057 Amendment 5 — so for an alarm whose organization-filtered row
 * group is empty the round trip could not change the answer. The phase now
 * hoists that organization filter above the read and skips the candidate when
 * the group is empty.
 *
 * **A new file rather than three more cases in
 * `alarm-lifecycle-raise-retry.spec.ts`, for two measured reasons.** That file
 * stands at 905 of AGENTS.md §4.5's 1000-line cap, and three cases in this
 * repository's docblock style are 130-180 lines, which leaves no headroom for a
 * review correction. More important: its wrapper is a SINGLE `it()` over
 * nineteen cases, so `assert` throwing means a mutation reddens whichever case
 * runs first rather than the one that owns the claim (`F4.105`). One `it()` per
 * case here, the `alarm-lifecycle-cleared-no-recipients.spec.ts` shape.
 *
 * The case numbers continue that file's sequence — R20, R21, R22 — because they
 * are cases of the same phase and a reader looking for R17 must not find two
 * different ones.
 *
 * **What this file cannot prove, stated so nobody reads more into it.** The
 * fakes apply no `WHERE` and hold no connection: `fakeDeps` records every rule
 * id `loadRuleChannels` was called with and answers from an array. So what is
 * gated below is the ABSENCE and the PRESENCE of those calls, and nothing at
 * all about a database round trip or its cost. The round trips were counted on
 * the running stack instead, as `pg_stat_all_tables` scan-count deltas over a
 * two-tick window, and that measurement is recorded in ADR 0057 Amendment 9 —
 * not here, because no suite in this repository can take it.
 *
 * **Every absence rides beside a positive on the same fixture.** Each case
 * carries two alarms on two DIFFERENT rules, one holding evidence and one not,
 * and asserts the whole `ruleChannelLoads` list in one assertion: an absence
 * asserted alone passes when the phase never ran at all, which has cost this
 * repository three times.
 */

/**
 * R20 — an alarm that holds no ledger row costs no channel read, and the alarm
 * that holds one still pays for it.
 *
 * `alarm-1` has no row at all; `alarm-2`, on another rule, has a `failed` one.
 * The two rules are the point: with both alarms on one rule the memo would hide
 * the saving, because the read the guard skips would be paid for the other
 * alarm anyway.
 *
 * **Mutations:** deleting `if (evidence.length === 0) continue;` reads
 * `rule-1`'s channels for an alarm that owes nobody, red on assertion 2; a
 * guard that skips unconditionally reads nothing at all, also red on assertion
 * 2 and red again on assertion 3.
 */
export async function assertNoEvidenceMeansNoChannelRead(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ id: "alarm-1" }), alarmRow({ id: "alarm-2", ruleId: "rule-2" })],
    rules: [ruleRow(), ruleRow({ id: "rule-2", code: "RULE-2" })],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed", { alarmId: "alarm-2" })],
  });
  await runLifecycleSweep(deps, NOW);

  // The fixture's precondition, not a claim about the guard: both alarms are
  // candidates and the ledger was asked about both, so the skip below happens
  // after the ledger read rather than upstream at candidate selection. No
  // mutation of the guard reddens this.
  const asked = (recorded.raiseAttemptReads[0] ?? []).map((ref) => ref.alarmId).join(",");
  assert(asked === "alarm-1,alarm-2", `the ledger is asked about both alarms, got [${asked}]`);
  // Both arms in ONE assertion: no read for the rule whose only alarm holds no
  // row, one read for the rule whose alarm holds one.
  assert(
    recorded.ruleChannelLoads.join(",") === "rule-2",
    `only the rule whose alarm holds a row is read, got [${recorded.ruleChannelLoads.join(",")}]`,
  );
  const sent = retries(recorded);
  assert(
    sent.length === 1 && sent[0]?.input.alarmId === "alarm-2",
    `the phase carries on past the guard and re-offers the alarm that has evidence, got ${JSON.stringify(
      sent.map((entry) => entry.input.alarmId),
    )}`,
  );
}

/**
 * R21 — the guard reads the ORGANIZATION-FILTERED group, and the organization
 * it filters on is the ref's, which is the RULE's.
 *
 * `alarm-1`'s only row carries `ORG_B`. Its rule is `ORG_A`, and every delivery
 * row for that alarm was stamped with the rule's organization
 * (`toDispatchInput`), so a foreign row is not evidence: the ledger query's
 * three `IN` lists are independent, so a row for this alarm under another
 * organization can reach the group. `alarm-1` is itself in `ORG_B` as well,
 * which separates the two axes the guard could confuse — R1 in the sibling
 * separates the same two.
 *
 * **Mutations, and this case is the only gate on either.** A guard written
 * `rowsByAlarm.has(candidate.alarm.id)` is WIDER than the predicate it stands
 * in for and keeps this alarm's wasted read, red on assertion 1. A guard
 * filtering on `candidate.alarm.organizationId` instead of
 * `candidate.ref.organizationId` accepts the foreign row here, also red on
 * assertion 1. R2 in the sibling gates the predicate's own organization
 * re-check and stays green under the first of those; R1 reddens under the
 * second, but only as the first case of a single `it()` over nineteen.
 */
export async function assertTheGuardReadsTheOrganizationFilteredGroup(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", organizationId: ORG_B }),
      alarmRow({ id: "alarm-2", ruleId: "rule-2" }),
    ],
    rules: [ruleRow(), ruleRow({ id: "rule-2", code: "RULE-2" })],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1", organizationId: ORG_B }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.ruleChannelLoads.join(",") === "rule-2",
    `a foreign row is not evidence, so only the rule with a same-organization row is read, got [${recorded.ruleChannelLoads.join(
      ",",
    )}]`,
  );
  const sent = retries(recorded);
  assert(
    sent.length === 1 && sent[0]?.input.alarmId === "alarm-2",
    `and only that alarm is re-offered, got ${JSON.stringify(sent.map((entry) => entry.input.alarmId))}`,
  );
}

/**
 * R22 — an alarm the read lists as `unread` is decided about in no way at all,
 * even when the read handed back a row for it.
 *
 * This is the `read.unread` skip's own gate, and it exists because `F3.59` took
 * R16's. R16 asserted that an undecidable alarm costs no channel read on a
 * fixture whose unread alarm holds no row, so the evidence guard now skips that
 * alarm one line later and R16 stays green with the skip deleted.
 *
 * **The fixture is a read shape `loadRaiseAttempts` cannot produce, which
 * AGENTS.md §4.6 permits and requires saying so.** The chain, from
 * `raise-attempts.ts`: `raiseAttemptBatches` slices `refs` into DISJOINT
 * batches; `selectBatch` binds `inArray(alarm_id, batch.alarmIds)`, so a
 * returned row's `alarmId` is in its own batch's list; and a batch that throws
 * adds ALL of its `alarmIds` to `unread`. One alarm holding both a row and an
 * `unread` entry therefore needs to be in two batches, which needs a duplicate
 * ref — and `runRaiseRetryPhase` builds exactly one candidate, and so one ref,
 * per entry of `loadActiveAlarms`. A sentinel STRONGER than production is the
 * right instrument here: what it gates is `RaiseAttemptsRead.unread`'s contract
 * — "the caller must decide NOTHING about these this tick" — rather than a
 * production path. **A later reader must
 * not "fix" this fixture into a producible one**: made producible it would be
 * R20 again, and the skip would have no gate at all.
 *
 * **Mutation:** deleting the `read.unread` skip reads `rule-1`'s channels and
 * re-offers `alarm-1`, red on assertion 1.
 */
export async function assertAnUnreadAlarmIsDecidedAboutNothingEvenWhenARowCameBack(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ id: "alarm-1" }), alarmRow({ id: "alarm-2", ruleId: "rule-2" })],
    rules: [ruleRow(), ruleRow({ id: "rule-2", code: "RULE-2" })],
    sample: freshMatching,
    loadRaiseAttempts: () =>
      Promise.resolve({
        rows: [
          attempt(C1.id, "failed", { alarmId: "alarm-1" }),
          attempt(C1.id, "failed", { alarmId: "alarm-2" }),
        ],
        unread: new Set(["alarm-1"]),
        reasons: ["batch returned then reported failed"],
      }),
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.ruleChannelLoads.join(",") === "rule-2",
    `the unread alarm's rule is not read even though a row came back for it, got [${recorded.ruleChannelLoads.join(
      ",",
    )}]`,
  );
  const sent = retries(recorded);
  assert(
    sent.length === 1 && sent[0]?.input.alarmId === "alarm-2",
    `and nothing is decided about the unread alarm, got ${JSON.stringify(
      sent.map((entry) => entry.input.alarmId),
    )}`,
  );
}
