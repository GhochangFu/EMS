import { buildDedupeKey } from "../notifications/dedupe-key";
import { PROCESS_STARTED_AT } from "../notifications/notifications.config";
import { MAX_EVENT_ATTEMPTS } from "../notifications/dispatch-policy";
import type { RaiseAttemptRow } from "../notifications/raise-retry";
import { LostLedgerRows } from "../notifications/raise-retry";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
  C2,
  NOW,
  ORG_A,
  ORG_B,
  type Recorded,
  alarmRow,
  assert,
  fakeDeps,
  ruleRow,
  secondsBefore,
  twoStepCatalog,
} from "./alarm-lifecycle.service.spec";

/**
 * `F3.51` — the lifecycle sweep's RAISE-RETRY phase over fakes (ADR 0041
 * Amendment 5, ADR 0057 Amendment 5). Assertions live here; the sibling
 * `.test` is the Vitest entry point (ADR 0014).
 *
 * A raise that did not send was lost for the life of the alarm: its outcome is
 * recorded under the key `rule:alarm:severity`, and the next evaluation of the
 * same rule arrives with `raised: false` and `alarmId: null`, so
 * `buildDedupeKey` produces a different key and the dispatch lands in the
 * transition-dedupe branch. The sweep's third phase re-offers the alarm's
 * ORIGINAL raise — same input, same key, no event — to exactly the channels
 * the ledger shows are still owed it.
 *
 * **A new file, and the fixture is imported rather than rebuilt.**
 * `alarm-lifecycle.service.spec.ts` stood at 726 of AGENTS.md §4.5's 1000-line
 * cap, so it exports `fakeDeps` and its rows and this file drives them — the
 * shape `notifications.events.spec.ts` already uses against
 * `notifications.service.spec.ts`.
 *
 * **Those thirteen cases gate NONE of this.** With owner ruling 3's evidence
 * conjunct a channel with no row under the raise key is not owed, and
 * `fakeDeps` defaults its ledger to empty — so every one of them re-offers
 * nobody and would go on passing if this phase were deleted. A reader must not
 * mistake that green suite for coverage of the phase; the cases below are the
 * whole of it.
 *
 * Twelve of them are green **unchanged**. The thirteenth,
 * `testUnmappedSeverityAndOrganizationlessRule`, had one count widened from
 * one warn to two: an org-less rule is now refused by two phases and each says
 * so once. That is stated here rather than left for a reader to find, because
 * "the existing cases are untouched" would otherwise be a false sentence in
 * this docblock — and R12 below, not that case, is the gate on the org-less
 * guard in this phase.
 *
 * **What this file cannot prove.** The fakes apply no `WHERE`, so nothing here
 * shows a row being filtered out by the ledger read — that a
 * `skipped_rate_limited` row survives it, that another organization's row does
 * not, and that a step's key never joins the set are
 * `raise-attempts.integration.spec.ts`'s claims. That a re-offered raise
 * refused by the hourly ceiling writes no row is
 * `notifications.events.spec.ts` E15–E18 and
 * `alarm-lifecycle.integration.spec.ts` I2; `isOverHourlyLimit` reads the wall
 * clock, which no fake here moves.
 *
 * **Every absence is paired with the positive that proves the phase ran**, on
 * the same fixture — R9's rejecting read is followed by the working one, R4's
 * unoffered channel rides beside an offered one. An absence on its own passes
 * when the action never happens at all, which has cost this repository three
 * times.
 */

const RAISE_KEY = "rule-1:alarm-1:warning";

/** One ledger row under the raise key. `attemptedAt` defaults to a stale instant — see {@link stale}. */
function attempt(
  channelId: string,
  status: string,
  overrides: Partial<RaiseAttemptRow> = {},
): RaiseAttemptRow {
  return {
    alarmId: "alarm-1",
    organizationId: ORG_A,
    channelId,
    status,
    attemptedAt: stale,
    ...overrides,
  };
}

/**
 * Both instants are relative to `PROCESS_STARTED_AT`, not to the fixture's
 * `NOW`: `unconfiguredWatermark` is `max(channel.updatedAt, PROCESS_STARTED_AT)`
 * and the process boundary is the later of the two here (`C1.updatedAt` is
 * 2020), so a row's side of the watermark must be measured from the constant
 * the sweep really passes. `F3.50` established that no suite can move that
 * constant; what a suite CAN do is place a row either side of it.
 */
const stale = new Date(PROCESS_STARTED_AT.getTime() - 60_000);
const fresh = new Date(PROCESS_STARTED_AT.getTime() + 60_000);

/** A matching sample keeps the clear phase inert: nothing stamps, nothing clears. */
const freshMatching = { time: secondsBefore(5), value: 150, unit: "kW" };
const freshNonMatching = { time: secondsBefore(5), value: 50, unit: "kW" };

/** The dispatches this phase made — never an index into every dispatch (a clear or a step shares the list). */
function retries(recorded: Recorded): Recorded["dispatches"] {
  return recorded.dispatches.filter((entry) => entry.input.reoffered === true);
}

function channelCodes(entry: Recorded["dispatches"][number] | undefined): string {
  return (entry?.channels ?? []).map((channel) => channel.code).join(",");
}

/**
 * R1 — one alarm, one `failed` row on C1: the original raise is offered again,
 * to C1 only, field for field, under the ORIGINAL key.
 *
 * The fixture separates the two axes the builder could confuse. The rule's
 * severity is `critical` and the alarm's is `warning`; the alarm's
 * organization is `ORG_B` and the rule's is `ORG_A`, which is what every
 * delivery row for this alarm was stamped with (`toDispatchInput`, plan D12) —
 * so a ref built from `alarm.organizationId` would match no row at all.
 */
async function testTheOriginalRaiseIsOfferedAgain(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ organizationId: ORG_B })],
    rules: [ruleRow({ severity: "critical" })],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed")],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  const dispatch = sent[0];
  if (!dispatch) return;
  assert(dispatch.input.event === undefined, "no event — this is the raise, not a step or a clear");
  // Asserted, never assumed. `raised: false` with no event reaches
  // `dispatchToChannel`'s transition dedupe, which writes a `skipped_deduped`
  // row UNDER THE RAISE KEY — and `channelsOwedTheRaise`'s "not failed" arm
  // would then block that key for the life of the alarm.
  assert(dispatch.input.raised === true, "raised: true, so the transition dedupe is not reached");
  assert(dispatch.input.reoffered === true, "reoffered: true, so a ceiling refusal writes no row");
  assert(
    dispatch.input.message === "Feeder overload: kw = 150 (gt 100)",
    `the alarm's message verbatim, got "${dispatch.input.message}"`,
  );
  assert(dispatch.input.alarmId === "alarm-1", "the alarm id");
  assert(
    dispatch.input.organizationId === ORG_A,
    `the RULE's organization, as toDispatchInput stamped the original, got ${dispatch.input.organizationId}`,
  );
  assert(
    dispatch.input.severity === "warning",
    `the ALARM's severity, not the rule's critical, got ${String(dispatch.input.severity)}`,
  );
  assert(channelCodes(dispatch) === "c1", `only the owed channel, got [${channelCodes(dispatch)}]`);

  const ref = recorded.raiseAttemptReads[0]?.[0];
  assert(ref !== undefined, "the phase read the ledger");
  assert(
    ref?.dedupeKey === RAISE_KEY,
    `the ref is keyed on the ORIGINAL raise, got ${String(ref?.dedupeKey)}`,
  );
  assert(
    buildDedupeKey(dispatch.input) === ref?.dedupeKey,
    `the dispatch lands under the very key the rows were read from; got ${buildDedupeKey(
      dispatch.input,
    )} against ${String(ref?.dedupeKey)}`,
  );
  assert(
    ref?.organizationId === ORG_A,
    `the ref carries the RULE's organization, not the alarm's ${ORG_B}; got ${String(ref?.organizationId)}`,
  );
}

/**
 * R2 — a `sent` row blocks its channel; the other, holding only a failure, is
 * still owed.
 *
 * The third row is the organization re-check. `raiseAttempts`' three `IN`
 * lists are independent, so a row for this alarm stamped with ANOTHER
 * organization can reach the group; it must be dropped before the predicate
 * sees it, or a foreign `sent` row would silence this alarm's retry for ever.
 */
async function testASentRowBlocksThatChannelOnly(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "sent"),
      attempt(C2.id, "failed"),
      attempt(C2.id, "sent", { organizationId: ORG_B }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    channelCodes(sent[0]) === "c2",
    `the channel that was told is not told again, and another organization's row is not this alarm's evidence; got [${channelCodes(
      sent[0],
    )}]`,
  );
}

/** R3 — the cap is `MAX_EVENT_ATTEMPTS`, and it is the constant the service exports, not a literal here. */
async function testTheCapIsTheServicesConstant(): Promise<void> {
  const rows: RaiseAttemptRow[] = [];
  for (let i = 0; i < MAX_EVENT_ATTEMPTS - 1; i += 1) {
    rows.push(attempt(C1.id, "failed"));
  }
  for (let i = 0; i < MAX_EVENT_ATTEMPTS; i += 1) {
    rows.push(attempt(C2.id, "failed"));
  }
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: rows,
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    channelCodes(sent[0]) === "c1",
    `one attempt short is still owed, ${MAX_EVENT_ATTEMPTS} is spent; got [${channelCodes(sent[0])}]`,
  );
}

/**
 * R4 — owner ruling 3's evidence conjunct, and it is the same-tick
 * double-send gate: a channel with NO row under the key has not been offered
 * the raise yet, so the sweep must not offer it a second time on the tick the
 * raise path is still dispatching it.
 */
async function testAChannelWithNoRowIsNotOwed(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [attempt(C2.id, "failed")],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    channelCodes(sent[0]) === "c2",
    `only the channel the ledger has evidence for, got [${channelCodes(sent[0])}]`,
  );
}

/**
 * R5 — the watermark is wired, and it is `max(channel.updatedAt,
 * PROCESS_STARTED_AT)`. C1's `skipped_unconfigured` row predates the process
 * boundary, so it is history and C1 is owed again; C2's postdates it, so it is
 * still the answer and C2 is not.
 */
async function testTheUnconfiguredWatermarkIsWired(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "skipped_unconfigured", { attemptedAt: stale }),
      attempt(C2.id, "skipped_unconfigured", { attemptedAt: fresh }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    channelCodes(sent[0]) === "c1",
    `the refusal that predates the process start is released, the later one still answers; got [${channelCodes(
      sent[0],
    )}]`,
  );
}

/**
 * R6 — an alarm that clears on this tick is not re-offered its raise. It has
 * already had its "Cleared:" message, and re-offering the raise afterwards
 * would tell people about a resolved alarm in the wrong order.
 *
 * The positive twin is in the same case: the alarm that did NOT clear is
 * re-offered, and the cleared one's `cleared` dispatch is there to prove the
 * clear phase really ran.
 */
async function testAnAlarmClearingThisTickIsNotReoffered(): Promise<void> {
  const clearing = alarmRow({ id: "alarm-1", normalSince: secondsBefore(120) });
  const staying = alarmRow({ id: "alarm-2", normalSince: null });
  const { deps, recorded } = fakeDeps({
    alarms: [clearing, staying],
    rules: [ruleRow()],
    sample: freshNonMatching,
    sentChannelIds: [C1.id],
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.dispatches.some((entry) => entry.input.event?.kind === "cleared"),
    "the clear phase ran and dispatched the cleared message",
  );
  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    sent[0]?.input.alarmId === "alarm-2",
    `for the alarm that is still open, got ${String(sent[0]?.input.alarmId)}`,
  );
  assert(
    (recorded.raiseAttemptReads[0] ?? []).map((ref) => ref.alarmId).join(",") === "alarm-2",
    `the cleared alarm contributes no ref, got [${(recorded.raiseAttemptReads[0] ?? [])
      .map((ref) => ref.alarmId)
      .join(",")}]`,
  );
}

/** R7 — owner ruling 4: an acknowledged alarm is skipped, and contributes no ref. */
async function testAnAcknowledgedAlarmIsSkipped(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", acknowledgedAt: secondsBefore(30) }),
      alarmRow({ id: "alarm-2" }),
    ],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    sent[0]?.input.alarmId === "alarm-2",
    `for the unacknowledged alarm, got ${String(sent[0]?.input.alarmId)}`,
  );
  assert(
    (recorded.raiseAttemptReads[0] ?? []).map((ref) => ref.alarmId).join(",") === "alarm-2",
    "the acknowledged alarm contributes no ref either",
  );
}

/**
 * R8 — the phase holds no state between ticks: the ledger is the state. Two
 * ticks over an unchanged ledger re-offer twice and read twice.
 *
 * Modelled on `testADueStepIsReofferedOnEveryTick`, which exists because
 * `F3.48` shipped without it. A per-process "already offered" cache, or a
 * phase that only offers on the tick a row first appears, reddens here.
 */
async function testTheRaiseIsReofferedOnEveryTick(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed")],
  });
  await runLifecycleSweep(deps, NOW);
  await runLifecycleSweep(deps, new Date(NOW.getTime() + 30_000));

  assert(retries(recorded).length === 2, `two re-offers, got ${retries(recorded).length}`);
  assert(
    recorded.raiseAttemptReads.length === 2,
    `and two ledger reads, got ${recorded.raiseAttemptReads.length}`,
  );
}

/**
 * R9 — a ledger read that rejects warns and returns FROM THE PHASE. It never
 * falls back to treating every channel as owed: silence costs one tick, a
 * blind re-offer costs a duplicate to every channel of every open alarm.
 *
 * Two halves on one fixture builder, because neither is a gate alone. The
 * first is an absence — no re-offer — and it is only meaningful beside the
 * escalation step that still goes out in the same tick, which proves the
 * `return` is inside the phase and not out of the sweep. The second runs the
 * identical fixture with a working read and gets the re-offer, which proves
 * the absence was the rejection's doing and not a fixture that owed nobody.
 */
async function testARejectedLedgerReadWarnsAndStopsThePhaseOnly(): Promise<void> {
  const alarms = [alarmRow({ raisedAt: secondsBefore(61) })];
  const rules = [ruleRow()];
  const rows = [attempt(C1.id, "failed")];

  const refused = fakeDeps({
    alarms,
    rules,
    sample: freshMatching,
    catalog: twoStepCatalog(),
    loadRaiseAttempts: () => Promise.reject(new Error("ledger unreachable")),
    raiseAttempts: rows,
  });
  await runLifecycleSweep(refused.deps, NOW);

  assert(retries(refused.recorded).length === 0, "nothing is re-offered on a failed read");
  const steps = refused.recorded.dispatches.filter(
    (entry) => entry.input.event?.kind === "escalation",
  );
  assert(
    steps.length === 1 && steps[0]?.input.alarmId === "alarm-1",
    `the escalation phase still runs in the same tick, got ${JSON.stringify(
      refused.recorded.dispatches.map((entry) => entry.input.event?.kind ?? "raise"),
    )}`,
  );
  assert(
    refused.recorded.warnings.length === 1,
    `one warn, not one per alarm, got ${JSON.stringify(refused.recorded.warnings)}`,
  );
  const warning = refused.recorded.warnings[0] ?? "";
  assert(warning.includes("ledger unreachable"), `the warn carries the cause, got "${warning}"`);
  assert(warning.includes("raise"), `and says which read failed, got "${warning}"`);
  assert(!warning.includes("Feeder overload"), "§9.6: the warn carries no alarm text");
  assert(
    refused.recorded.ruleChannelLoads.length === 0,
    `the phase RETURNS — it does not carry on with an empty row set, which would cost a channel read per rule and still owe nobody; got ${refused.recorded.ruleChannelLoads.length} reads`,
  );

  const working = fakeDeps({
    alarms,
    rules,
    sample: freshMatching,
    catalog: twoStepCatalog(),
    raiseAttempts: rows,
  });
  await runLifecycleSweep(working.deps, NOW);
  assert(
    retries(working.recorded).length === 1,
    `the same fixture with a working read re-offers once, got ${retries(working.recorded).length}`,
  );
  assert(working.recorded.warnings.length === 0, "and warns about nothing");
}

/**
 * R10 — the phase runs BEFORE the escalation. The two share one hourly budget
 * per channel and organization, and whichever dispatches first takes it: an
 * escalation backlog must not starve a new critical alarm's raise. It also
 * keeps the reader's sequence right — the alarm, then step 1, never step 2
 * followed by the original alarm.
 */
async function testTheRetryGoesBeforeTheEscalation(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(61) })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(),
    raiseAttempts: [attempt(C1.id, "failed")],
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.dispatches.length === 2,
    `the raise and one step, got ${recorded.dispatches.length}`,
  );
  assert(
    recorded.dispatches[0]?.input.reoffered === true,
    `the re-offered raise goes first, got ${JSON.stringify(recorded.dispatches[0]?.input.event)}`,
  );
  assert(
    recorded.dispatches[1]?.input.event?.kind === "escalation",
    `then the step, got ${JSON.stringify(recorded.dispatches[1]?.input.event)}`,
  );
}

/**
 * R11 — a rule whose action is no longer `notify` stops being re-offered.
 *
 * This is NOT redundant with the evidence conjunct, and the one case that
 * matters is exactly this fixture: a rule that WAS `notify` when the alarm was
 * raised has rows under the key, so it has evidence, and only the action gate
 * stops it. Deliberately different from the escalation phase's ruling Q8 ("the
 * rule's action is not consulted"): a step is the organization's severity
 * policy, whereas the raise IS the action.
 */
async function testARuleNoLongerNotifyingIsNotReoffered(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-review" }),
      alarmRow({ id: "alarm-2", ruleId: "rule-1" }),
    ],
    rules: [
      ruleRow({ id: "rule-review", code: "RULE-REVIEW", action: { type: "review" } }),
      ruleRow(),
    ],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(
    sent[0]?.input.alarmId === "alarm-2",
    `for the notify rule only, got ${String(sent[0]?.input.alarmId)}`,
  );
  assert(
    (recorded.raiseAttemptReads[0] ?? []).map((ref) => ref.alarmId).join(",") === "alarm-2",
    "the review rule's alarm contributes no ref",
  );
}

/** R12 — an org-less rule yields no input: one warn with the ids, no alarm text, no ref, no dispatch. */
async function testAnOrganizationlessRuleWarnsAndIsSkipped(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-orgless" }),
      alarmRow({ id: "alarm-2", ruleId: "rule-1" }),
    ],
    rules: [
      ruleRow({ id: "rule-orgless", code: "RULE-ORGLESS", organizationId: null }),
      ruleRow(),
    ],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `one re-offer, got ${sent.length}`);
  assert(sent[0]?.input.alarmId === "alarm-2", "for the rule that has an organization");
  assert(
    (recorded.raiseAttemptReads[0] ?? []).map((ref) => ref.alarmId).join(",") === "alarm-2",
    "the org-less alarm contributes no ref — the guard runs before the ref is built",
  );
  const warning = recorded.warnings.find((line) => line.includes("RULE-ORGLESS")) ?? "";
  assert(warning !== "", `one warn names the rule code, got ${JSON.stringify(recorded.warnings)}`);
  assert(
    warning.includes("rule-orgless") && warning.includes("alarm-1"),
    `§9.6: the rule id and the alarm id, got "${warning}"`,
  );
  assert(!warning.includes("Feeder overload"), "§9.6: and no alarm text");
}

/**
 * R13 — the channel read is memoised per rule for the tick. Two alarms on one
 * rule cost one `loadRuleChannels` call, which is the claim the phase's
 * comment makes about its per-tick read cost; without a case, that sentence
 * would be an ungated generalisation.
 */
async function testRuleChannelsAreReadOncePerRulePerTick(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ id: "alarm-1" }), alarmRow({ id: "alarm-2" })],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
  });
  await runLifecycleSweep(deps, NOW);

  assert(retries(recorded).length === 2, `both alarms are re-offered, got ${retries(recorded).length}`);
  assert(
    recorded.ruleChannelLoads.join(",") === "rule-1",
    `one channel read for the one rule, got [${recorded.ruleChannelLoads.join(",")}]`,
  );
  assert(
    recorded.raiseAttemptReads.length === 1,
    `and one ledger read for the tick, got ${recorded.raiseAttemptReads.length}`,
  );
}

/** R14 — no eligible alarm, no query. The paired positive is R13's single read on the same shape. */
async function testNoEligibleAlarmMeansNoLedgerRead(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ acknowledgedAt: secondsBefore(30) })],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed")],
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.raiseAttemptReads.length === 0,
    `an empty eligible list asks the ledger nothing, got ${recorded.raiseAttemptReads.length} reads`,
  );
  assert(retries(recorded).length === 0, "and re-offers nobody");
  assert(recorded.ruleChannelLoads.length === 0, "and reads no rule's channels");
}

/**
 * R15 — one alarm's failure does not abort the tick. The dispatch for the
 * first alarm rejects; the second alarm is still re-offered, and the warn
 * names the ids and the cause and carries no alarm text (§9.6). The escalation
 * phase's per-item shape.
 */
async function testOneAlarmFailingDoesNotStopTheNext(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ id: "alarm-1" }), alarmRow({ id: "alarm-2" })],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [
      attempt(C1.id, "failed", { alarmId: "alarm-1" }),
      attempt(C1.id, "failed", { alarmId: "alarm-2" }),
    ],
    ruleChannels: () => [C1],
  });
  const inner = deps.dispatchToChannels.bind(deps);
  let first = true;
  deps.dispatchToChannels = (channels, input) => {
    if (input.reoffered === true && first) {
      first = false;
      return Promise.reject(new Error("transport pool exhausted"));
    }
    return inner(channels, input);
  };
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(sent.length === 1, `the second alarm is still re-offered, got ${sent.length}`);
  assert(sent[0]?.input.alarmId === "alarm-2", "and it is the second one");
  const warning = recorded.warnings[0] ?? "";
  assert(recorded.warnings.length === 1, `one warn, got ${JSON.stringify(recorded.warnings)}`);
  assert(
    warning.includes("alarm-1") && warning.includes("RULE-1") && warning.includes("transport pool exhausted"),
    `§9.6: the alarm id, the rule code and the cause, got "${warning}"`,
  );
  assert(!warning.includes("Feeder overload"), "§9.6: and no alarm text");
}

/**
 * R16 (`F3.51` review, Medium) — one BATCH of the ledger read failed, not the
 * whole of it. The read is chunked at `RAISE_ATTEMPT_BATCH_SIZE`, so a
 * statement that dies takes only the alarms it bound; before the chunking, the
 * phase's `catch` returned from the whole phase and one tenant's alarm volume
 * disabled raise retry fleet-wide.
 *
 * The absence — `alarm-1`, in the failed batch, is not re-offered — is paired
 * on the SAME fixture with two positives that prove the phase did not simply
 * stop: `alarm-2`, in the batch that returned, IS re-offered, and the
 * escalation phase still dispatches its due step in the same tick.
 *
 * **What the `read.unread` skip really costs, stated exactly.** It is not what
 * stops the blind re-offer: an unread alarm's rows are in the failed batch, so
 * its group is empty and ruling 3's evidence conjunct already answers "not
 * owed". What the skip buys is the channel read — the assertion on
 * `ruleChannelLoads` below is its only gate, which is why the two alarms sit on
 * two DIFFERENT rules here. R9 makes the same claim for the phase-wide failure.
 *
 * **Mutations:** `if (read.reasons.length > 0) return;` (the old per-phase
 * shape) → `alarm-2` is not re-offered, red. Dropping the `read.unread` skip →
 * `rule-2`'s channels are read for an alarm nothing can be decided about, red
 * on `ruleChannelLoads`.
 */
async function testAFailedBatchCostsOnlyItsOwnAlarms(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-1", ruleId: "rule-2", raisedAt: secondsBefore(61) }),
      alarmRow({ id: "alarm-2", raisedAt: secondsBefore(61) }),
    ],
    rules: [ruleRow(), ruleRow({ id: "rule-2", code: "RULE-2" })],
    sample: freshMatching,
    catalog: twoStepCatalog(),
    ruleChannels: () => [C1],
    // The batch holding `alarm-1` failed; the batch holding `alarm-2`
    // returned its row.
    loadRaiseAttempts: () =>
      Promise.resolve({
        rows: [attempt(C1.id, "failed", { alarmId: "alarm-2" })],
        unread: new Set(["alarm-1"]),
        reasons: ["too many bind parameters"],
      }),
  });
  await runLifecycleSweep(deps, NOW);

  const sent = retries(recorded);
  assert(
    sent.length === 1 && sent[0]?.input.alarmId === "alarm-2",
    `only the alarm whose batch returned is re-offered, got ${JSON.stringify(
      sent.map((entry) => entry.input.alarmId),
    )}`,
  );
  assert(
    recorded.ruleChannelLoads.join(",") === "rule-1",
    `no channel read is spent on the rule whose only alarm is undecidable, got [${recorded.ruleChannelLoads.join(
      ",",
    )}]`,
  );
  const steps = recorded.dispatches.filter((entry) => entry.input.event?.kind === "escalation");
  assert(
    steps.length === 2,
    `the escalation phase still runs for both alarms in the same tick, got ${steps.length}`,
  );
  assert(recorded.warnings.length === 1, `one warn, got ${JSON.stringify(recorded.warnings)}`);
  const warning = recorded.warnings[0] ?? "";
  assert(
    warning.includes("1 batch(es)") && warning.includes("too many bind parameters"),
    `the warn carries the batch count and the cause, got "${warning}"`,
  );
  assert(
    warning.includes("1 of 2 alarm(s)"),
    `and how much of the tick was lost, got "${warning}"`,
  );
  assert(!warning.includes("Feeder overload"), "§9.6: the warn carries no alarm text");
}

/**
 * R17 (`F3.51` review, High) — a delivery row that did not land stops the
 * retry re-offering that channel.
 *
 * `record()` catches its own INSERT failure, logs and returns the result: ADR
 * 0041 decision 1 says a dispatch never fails its caller. If writes fail while
 * reads succeed, nothing is ever written under the raise key — so
 * `MAX_EVENT_ATTEMPTS` (it counts rows) and `isOverHourlyLimit` (it counts
 * `sent` rows) can never engage, `channelsOwedTheRaise` keeps seeing the same
 * single original `failed` row, and the phase sends to that channel twice a
 * minute for the life of the alarm with no ledger trace of any of it.
 *
 * Two ticks on one fixture. C1's row is lost, C2's lands. The absence — C1 is
 * not offered on tick two — is paired on the same fixture with the positive
 * that C2 IS, which is what makes the case a gate: an absence alone would pass
 * a phase that had stopped re-offering anything at all, and R8 exists precisely
 * because re-offering on every tick is the behaviour.
 *
 * **Mutation:** dropping the `lostLedgerRows.has` filter → C1 rides on tick
 * two, red on the channel list. Recording the loss under `(alarm, channel)`
 * without the key → not caught here; `raise-retry.spec.ts` P15 is that gate.
 */
async function testALostLedgerRowStopsTheReoffer(): Promise<void> {
  const lostLedgerRows = new LostLedgerRows();
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed"), attempt(C2.id, "failed")],
    lostLedgerRows,
  });
  const inner = deps.dispatchToChannels.bind(deps);
  deps.dispatchToChannels = async (channels, input) => {
    const outcomes = await inner(channels, input);
    // The ledger accepts C2's row and refuses C1's — the failure mode this
    // case exists for, where the reads keep working.
    return outcomes.map((outcome) => ({ ...outcome, rowLost: outcome.channelId === C1.id }));
  };

  await runLifecycleSweep(deps, NOW);
  const first = retries(recorded);
  assert(
    first.length === 1 && channelCodes(first[0]) === "c1,c2",
    `both channels are offered on the first tick, got [${channelCodes(first[0])}]`,
  );

  await runLifecycleSweep(deps, NOW);
  const second = retries(recorded).slice(1);
  assert(
    second.length === 1 && channelCodes(second[0]) === "c2",
    `the channel whose row was lost is not offered again; the one whose row landed is, got [${channelCodes(
      second[0],
    )}]`,
  );
  assert(
    lostLedgerRows.size === 1,
    `exactly one triple is remembered, got ${lostLedgerRows.size}`,
  );
  assert(
    lostLedgerRows.has("alarm-1", C1.id, RAISE_KEY),
    "and it is remembered under the alarm's own raise key",
  );
}

/**
 * R18 (`F3.51` review, High) — the memory is reclaimed when the alarm leaves
 * the active set, and only then.
 *
 * `loadActiveAlarms` filters `cleared_at IS NULL`, so a cleared alarm never
 * comes back and its entries are dead weight. The paired positive is in the
 * same case and on the same memory: the alarm still active keeps its entry, so
 * a `retainAlarms` that cleared everything would redden here rather than pass.
 *
 * **Mutation:** dropping the `retainAlarms` call → the first assertion goes to
 * 2, red. Evicting the whole map → the second reddens.
 */
async function testTheMemoryIsReclaimedWhenAnAlarmLeaves(): Promise<void> {
  const lostLedgerRows = new LostLedgerRows();
  lostLedgerRows.add("alarm-1", C1.id, RAISE_KEY);
  lostLedgerRows.add("alarm-gone", C1.id, "rule-1:alarm-gone:warning");

  const { deps } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    lostLedgerRows,
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    lostLedgerRows.size === 1,
    `the alarm no longer in the active set is evicted, got ${lostLedgerRows.size}`,
  );
  assert(
    lostLedgerRows.has("alarm-1", C1.id, RAISE_KEY),
    "and the alarm still open keeps its entry",
  );
}

/**
 * R19 (`F3.51` review, High) — at the cap the sweep says so, once, and the
 * refused pair falls back to being re-offered.
 *
 * The degradation is deliberate: refusing a new entry is preferred to evicting
 * an existing one, which would silently un-blacklist a real loss. What must not
 * happen is silence, so the tick warns with the cap and the count and no ids
 * (§9.6).
 *
 * **Mutation:** dropping the warn → red on the count. Evicting to make room →
 * red, because the pre-filled entry would be gone and its channel re-offered.
 */
async function testTheCapIsReportedAndDegradesToTheOldBehaviour(): Promise<void> {
  const lostLedgerRows = new LostLedgerRows(1);
  // The one entry the cap allows belongs to an alarm that is still ACTIVE —
  // otherwise `retainAlarms` frees it on the first tick and the cap is never
  // reached, which is how this case first failed.
  lostLedgerRows.add("alarm-1", C2.id, RAISE_KEY);

  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshMatching,
    raiseAttempts: [attempt(C1.id, "failed")],
    ruleChannels: () => [C1],
    lostLedgerRows,
  });
  const inner = deps.dispatchToChannels.bind(deps);
  deps.dispatchToChannels = async (channels, input) => {
    const outcomes = await inner(channels, input);
    return outcomes.map((outcome) => ({ ...outcome, rowLost: true }));
  };

  await runLifecycleSweep(deps, NOW);
  await runLifecycleSweep(deps, NOW);

  assert(
    retries(recorded).length === 2,
    `a pair the cap refused is re-offered on the next tick, got ${retries(recorded).length}`,
  );
  // The raise-retry wording, not the bare substring: `runEscalationPhase`
  // writes a line of the same shape from the same cap (`F3.51` second review),
  // and this case must count only its own phase's.
  const capWarnings = recorded.warnings.filter((line) =>
    line.includes("raise-retry lost-row memory is full"),
  );
  assert(
    capWarnings.length === 2,
    `one warn per tick, not one per pair, got ${JSON.stringify(recorded.warnings)}`,
  );
  const warning = capWarnings[0] ?? "";
  assert(
    warning.includes("1 entries") && warning.includes("1 further lost row"),
    `the warn carries the cap and the count, got "${warning}"`,
  );
  assert(!warning.includes("alarm-1"), "§9.6: and no ids — the cap is a fleet state, not an alarm's");
  assert(!warning.includes("Feeder overload"), "§9.6: and no alarm text");
}

export async function runAlarmLifecycleRaiseRetryTests(): Promise<void> {
  await testTheOriginalRaiseIsOfferedAgain();
  await testASentRowBlocksThatChannelOnly();
  await testTheCapIsTheServicesConstant();
  await testAChannelWithNoRowIsNotOwed();
  await testTheUnconfiguredWatermarkIsWired();
  await testAnAlarmClearingThisTickIsNotReoffered();
  await testAnAcknowledgedAlarmIsSkipped();
  await testTheRaiseIsReofferedOnEveryTick();
  await testARejectedLedgerReadWarnsAndStopsThePhaseOnly();
  await testTheRetryGoesBeforeTheEscalation();
  await testARuleNoLongerNotifyingIsNotReoffered();
  await testAnOrganizationlessRuleWarnsAndIsSkipped();
  await testRuleChannelsAreReadOncePerRulePerTick();
  await testNoEligibleAlarmMeansNoLedgerRead();
  await testOneAlarmFailingDoesNotStopTheNext();
  await testAFailedBatchCostsOnlyItsOwnAlarms();
  await testALostLedgerRowStopsTheReoffer();
  await testTheMemoryIsReclaimedWhenAnAlarmLeaves();
  await testTheCapIsReportedAndDegradesToTheOldBehaviour();
}
