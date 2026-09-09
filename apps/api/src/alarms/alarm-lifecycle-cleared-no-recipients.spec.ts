import type { NotificationChannelRow } from "../notifications/notification-transport";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
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
 * `F3.55` — a cleared message that reaches nobody says so (ADR 0057
 * Amendment 6).
 *
 * `notifyCleared` had two silent returns, one after each of its two reads, and
 * neither wrote a row, warned, or left any other trace. That is the state
 * Amendment 2's ruling Q-A calls worse than the defect `F3.48` set out to fix,
 * reached one layer ABOVE `dispatchToChannel` — which is why `F3.54`'s two
 * ternaries, which live inside it, do not touch either one.
 *
 * The two are different states and the owner's ruling gives each its own warn:
 *
 *  - **No channel holds a `sent` row for the alarm.** Nobody was told the raise
 *    through a channel that reported success, so there is no channel a delivery
 *    row could be attributed to.
 *  - **Channels hold one, and every one of them is disabled now.** A row
 *    against a disabled channel would record an attempt that was never made.
 *
 * Neither is a refusal, so neither writes a row — the same reason Amendment 4's
 * ruling 2 left `dispatchToChannels`'s two pre-check refusals alone.
 *
 * **Its own file, and the reason is two rules at once.** `AGENTS.md` §4.5 caps
 * a file at 1000 lines and `alarm-lifecycle.service.spec.ts` stands at 801;
 * `F4.105` requires one `it()` per numbered assertion, and that file's wrapper
 * is a single `it()` over thirteen cases, so a mutation there reddens whichever
 * case runs first rather than the case that owns the claim. The fixture is
 * imported from it, the shape `alarm-lifecycle-raise-retry.spec.ts` and
 * `alarm-lifecycle-escalation-lost-rows.spec.ts` already use.
 *
 * **Every absence is paired with a positive on the same fixture.** Both claims
 * here are "no dispatch", which passes when `notifyCleared` is never reached at
 * all — so C1 asserts the recipient read RAN, C2 asserts the channel read ran
 * with the sent id (which is only reachable past C1's return), and each has a
 * sibling fixture that differs in one option and DOES dispatch.
 *
 * **"No delivery row" at this layer means "no dispatch".** `dispatchToChannels`
 * is the sweep's only route to a `notification_deliveries` row; the fake
 * records the call rather than the insert. `alarm-lifecycle.integration.spec.ts`
 * is where a row is proved to land in Postgres.
 */

/** The sample that ends the hold: below the threshold, and fresh. */
const freshNonMatching = { time: secondsBefore(5), value: 50, unit: "kW" };

/** 120 s of normal, past `DEFAULT_CLEAR_HOLD_SECONDS`, so the fixture alarm clears this tick. */
const HOLD_STARTED = secondsBefore(120);

/**
 * The two discriminators an operator reads the log for. Held as constants and
 * asserted in both directions below, because "the two warns differ" passes
 * when the branches' strings are exchanged.
 */
const NO_SENT_ROW = "no channel holds a sent row";
const ALL_DISABLED = "every channel that holds a sent row for it is disabled";

/**
 * One alarm that clears this tick. The three fixtures below differ only in who
 * is owed the cleared message.
 */
function clearingDeps(opts: {
  sentChannelIds: string[];
  channels?: NotificationChannelRow[];
}): ReturnType<typeof fakeDeps> {
  return fakeDeps({
    alarms: [alarmRow({ normalSince: HOLD_STARTED })],
    rules: [ruleRow()],
    sample: freshNonMatching,
    sentChannelIds: opts.sentChannelIds,
    channels: opts.channels,
  });
}

/** No channel holds a `sent` row for the alarm — the first return. */
function noSentRowDeps(): ReturnType<typeof fakeDeps> {
  return clearingDeps({ sentChannelIds: [] });
}

/** A channel held one and is disabled now, so `loadEnabledChannelsByIds` drops it — the second return. */
function allDisabledDeps(): ReturnType<typeof fakeDeps> {
  return clearingDeps({ sentChannelIds: [C1.id], channels: [] });
}

/** The same clear with a recipient still enabled: the path that DOES dispatch. */
function reachedDeps(): ReturnType<typeof fakeDeps> {
  return clearingDeps({ sentChannelIds: [C1.id] });
}

function clearedDispatches(recorded: Recorded): Recorded["dispatches"] {
  return recorded.dispatches.filter((entry) => entry.input.event?.kind === "cleared");
}

/**
 * C1 — no channel holds a `sent` row: warned once, no channel read, nothing
 * dispatched. The paired positive is `sentReads`: it proves `notifyCleared`
 * reached its first read rather than returning at `!rule` or at the org-less
 * guard above it, which is what would make "no dispatch" vacuous.
 *
 * **Mutation:** deleting the `warn` at the `channelIds.length === 0` return
 * reddens the warn assertion; deleting the `return` reddens `channelLoads`.
 */
export async function assertNoSentRowIsWarnedNotSilent(): Promise<void> {
  const { deps, recorded } = noSentRowDeps();
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.sentReads.length === 1 && recorded.sentReads[0]?.alarmId === "alarm-1",
    `the recipient read ran for the cleared alarm, got ${JSON.stringify(recorded.sentReads)}`,
  );
  assert(
    recorded.warnings.length === 1,
    `one warn for the clear nobody was told, got ${JSON.stringify(recorded.warnings)}`,
  );
  assert(
    (recorded.warnings[0] ?? "").includes(NO_SENT_ROW),
    `the warn says which case it was, got "${recorded.warnings[0] ?? ""}"`,
  );
  assert(
    recorded.channelLoads.length === 0,
    `no channel read for an empty recipient list, got ${JSON.stringify(recorded.channelLoads)}`,
  );
  assert(
    clearedDispatches(recorded).length === 0,
    "and no cleared message — so no delivery row either",
  );

  // The same fixture with one `sent` row: the clear IS dispatched and nothing
  // is warned. Without this, every assertion above passes on a sweep that
  // never calls `notifyCleared` at all.
  const reached = reachedDeps();
  await runLifecycleSweep(reached.deps, NOW);
  assert(
    clearedDispatches(reached.recorded).length === 1,
    `one cleared message when a channel holds a sent row, got ${clearedDispatches(reached.recorded).length}`,
  );
  assert(
    reached.recorded.warnings.length === 0,
    `and nothing is warned, got ${JSON.stringify(reached.recorded.warnings)}`,
  );
}

/**
 * C2 — the channels held a `sent` row and every one is disabled: warned once,
 * nothing dispatched. The paired positive is `channelLoads`, which is only
 * reachable PAST C1's return, so it separates this case from that one.
 *
 * **Mutation:** deleting the `warn` at the `channels.length === 0` return
 * reddens the warn assertion; writing C1's warn here reddens the discriminator.
 */
export async function assertEveryRecipientDisabledIsWarnedNotSilent(): Promise<void> {
  const { deps, recorded } = allDisabledDeps();
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.channelLoads.length === 1 && recorded.channelLoads[0]?.join(",") === C1.id,
    `the channel read ran for the sent id, got ${JSON.stringify(recorded.channelLoads)}`,
  );
  assert(
    recorded.warnings.length === 1,
    `one warn for the clear whose recipients are disabled, got ${JSON.stringify(recorded.warnings)}`,
  );
  assert(
    (recorded.warnings[0] ?? "").includes(ALL_DISABLED),
    `the warn says which case it was, got "${recorded.warnings[0] ?? ""}"`,
  );
  assert(
    clearedDispatches(recorded).length === 0,
    "and no cleared message — so no delivery row against a disabled channel",
  );

  // The same sent id with the channel still enabled: dispatched, not warned.
  const reached = reachedDeps();
  await runLifecycleSweep(reached.deps, NOW);
  assert(
    clearedDispatches(reached.recorded).length === 1 &&
      clearedDispatches(reached.recorded)[0]?.channels[0]?.id === C1.id,
    `the same id enabled is dispatched to, got ${JSON.stringify(
      clearedDispatches(reached.recorded).map((entry) => entry.channels.map((c) => c.id)),
    )}`,
  );
  assert(reached.recorded.warnings.length === 0, "and nothing is warned");
}

/**
 * C3 — an operator can tell the two apart, and each names the alarm and the
 * rule. Asserted in BOTH directions: "the two strings differ" still passes when
 * the branches' strings are exchanged, which is the mutation to expect.
 *
 * **Mutation:** swapping the two warn strings reddens this and nothing else.
 */
export async function assertTheTwoWarnsAreDistinguishable(): Promise<void> {
  const none = noSentRowDeps();
  await runLifecycleSweep(none.deps, NOW);
  const disabled = allDisabledDeps();
  await runLifecycleSweep(disabled.deps, NOW);

  const noneWarn = none.recorded.warnings[0] ?? "";
  const disabledWarn = disabled.recorded.warnings[0] ?? "";

  assert(
    noneWarn.includes(NO_SENT_ROW) && !noneWarn.includes(ALL_DISABLED),
    `the no-sent-row warn carries only its own case, got "${noneWarn}"`,
  );
  assert(
    disabledWarn.includes(ALL_DISABLED) && !disabledWarn.includes(NO_SENT_ROW),
    `the disabled warn carries only its own case, got "${disabledWarn}"`,
  );
  for (const warning of [noneWarn, disabledWarn]) {
    assert(
      warning.includes("alarm-1") && warning.includes("RULE-1"),
      `each warn names the alarm id and the rule code, got "${warning}"`,
    );
  }
}

/**
 * C4 — §9.6. Neither warn carries the alarm text, a recipient's identity or a
 * channel's configuration. The two warns are the only new log lines this row
 * adds, and a warn is read on a shared operations console.
 *
 * **Mutation:** appending `alarm.message`, `channelIds.join(",")` or a channel
 * code to either string reddens this.
 */
export async function assertNeitherWarnLeaksAlarmTextOrRecipients(): Promise<void> {
  const none = noSentRowDeps();
  await runLifecycleSweep(none.deps, NOW);
  const disabled = allDisabledDeps();
  await runLifecycleSweep(disabled.deps, NOW);

  // Not vacuous: a redaction assertion over a warn that was never emitted
  // passes on the empty string, which is how this file read before the warns
  // existed. Both must be there before their contents mean anything.
  assert(
    none.recorded.warnings.length === 1 && disabled.recorded.warnings.length === 1,
    `both cases warn before their contents are asserted, got ${JSON.stringify([
      none.recorded.warnings,
      disabled.recorded.warnings,
    ])}`,
  );

  for (const warning of [none.recorded.warnings[0] ?? "", disabled.recorded.warnings[0] ?? ""]) {
    assert(!warning.includes("Feeder overload"), `§9.6: no alarm text, got "${warning}"`);
    assert(!warning.includes(C1.id), `§9.6: no recipient id, got "${warning}"`);
    assert(!warning.includes(`${C1.code} `) && !warning.endsWith(C1.code), `§9.6: no recipient code, got "${warning}"`);
    assert(!warning.includes("hooks.example.com"), `§9.6: no channel configuration, got "${warning}"`);
  }
}

/**
 * C5 — the clear itself is the ALARM's fact and is unchanged by either return:
 * both fixtures still write `cleared_at` under the alarm's organization and
 * still broadcast once. Only the message is skipped, and nothing is recorded
 * in its place.
 *
 * **Mutation:** returning before `writeAlarmState`, or writing a delivery row
 * at either return, reddens this.
 */
export async function assertTheClearItselfIsUnaffectedAtBothReturns(): Promise<void> {
  for (const [label, built] of [
    ["no sent row", noSentRowDeps()],
    ["every recipient disabled", allDisabledDeps()],
  ] as const) {
    const { deps, recorded } = built;
    await runLifecycleSweep(deps, NOW);

    assert(
      recorded.writes.length === 1 &&
        recorded.writes[0]?.organizationId === ORG_A &&
        recorded.writes[0].updates[0]?.alarmId === "alarm-1" &&
        recorded.writes[0].updates[0].clearedAt === NOW,
      `${label}: the alarm still clears, got ${JSON.stringify(recorded.writes)}`,
    );
    assert(
      recorded.broadcasts.length === 1 && recorded.broadcasts[0]?.id === "alarm-1",
      `${label}: and is still broadcast once, got ${JSON.stringify(recorded.broadcasts.length)}`,
    );
    assert(
      recorded.dispatches.length === 0,
      `${label}: with nothing dispatched in place of the message, got ${JSON.stringify(
        recorded.dispatches.map((entry) => entry.input.event?.kind ?? "raise"),
      )}`,
    );
  }
}
