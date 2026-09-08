import type { Logger } from "@nestjs/common";

import type { AlarmRaiseResult } from "../alarms/alarm-raise.service";
import type { DispatchOutcome } from "../notifications/dispatch-policy";
import type { DispatchInput } from "../notifications/notifications.service";
import { until, UntilTimeoutError } from "../testing/until";
import { notifyOnRaise, shouldNotify, toDispatchInput, type NotifiableRule } from "./rule-actions";

/** `asserts` so a `!== null` check narrows for the field loop that follows it. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const RULE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "aaaaaaaa-0000-0000-0000-00000000000a";
const ALARM_ID = "22222222-2222-2222-2222-222222222222";
const MESSAGE = "UPS-1 battery temperature is 48C.";

function rule(overrides: Partial<NotifiableRule> = {}): NotifiableRule {
  return {
    id: RULE_ID,
    code: "UPS-BATT-TEMP",
    organizationId: ORG_ID,
    action: { type: "notify", target: "Operations" },
    ...overrides,
  };
}

function raise(overrides: Partial<AlarmRaiseResult> = {}): AlarmRaiseResult {
  return {
    raised: true,
    alarmId: ALARM_ID,
    severity: "critical",
    message: MESSAGE,
    ...overrides,
  };
}

/** A recording `{ dispatch }` and a recording `{ warn }` — the two things `notifyOnRaise` touches. */
function fakeDeps(
  behaviour: () => Promise<DispatchOutcome[]> = () => Promise.resolve([]),
): { deps: Parameters<typeof notifyOnRaise>[0]; calls: DispatchInput[]; warns: string[] } {
  const calls: DispatchInput[] = [];
  const warns: string[] = [];
  const logger = {
    warn: (message: unknown) => {
      warns.push(String(message));
    },
  } as Pick<Logger, "warn">;
  return {
    deps: {
      notifications: {
        dispatch: (input) => {
          calls.push(input);
          return behaviour();
        },
      },
      logger,
    },
    calls,
    warns,
  };
}

/** One macrotask — enough for every microtask `dispatch().catch()` queues to run. */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Q3 (owner, 2026-09-06): `review` is inert. The predicate reads the action
 * through `asAction` so the narrowing lives in one place — a `notify` without a
 * `target` is refused *there*, and this asserts that behaviour rather than
 * re-implementing it.
 */
export function assertShouldNotifyReadsOnlyTheNotifyType(): void {
  assert(shouldNotify({ type: "notify", target: "Operations" }) === true, "notify + target notifies");

  const inert: [string, unknown][] = [
    ["review", { type: "review", target: "Operations" }],
    ["trace_only", { type: "trace_only", target: "Operations" }],
    ["an empty object", {}],
    ["null", null],
    ["a string", "notify"],
    ["notify without a target", { type: "notify" }],
  ];
  for (const [label, action] of inert) {
    assert(shouldNotify(action) === false, `${label} must not notify`);
  }
}

/**
 * D1: the notification's subject and body are the alarm's own `severity` and
 * `message`, carried on the raiser's result — never recomputed here.
 */
export function assertToDispatchInputMapsFieldForField(): void {
  const built = toDispatchInput(rule(), raise());
  assert(built !== null, "a rule with an organization builds an input");
  const expected: DispatchInput = {
    ruleId: RULE_ID,
    ruleCode: "UPS-BATT-TEMP",
    organizationId: ORG_ID,
    alarmId: ALARM_ID,
    severity: "critical",
    message: MESSAGE,
    raised: true,
  };
  for (const key of Object.keys(expected) as (keyof DispatchInput)[]) {
    assert(built[key] === expected[key], `${key} must map field for field, got ${String(built[key])}`);
  }
  assert(
    Object.keys(built).length === Object.keys(expected).length,
    `no extra field is carried, got ${Object.keys(built).join(",")}`,
  );

  // The dedupe result passes straight through: a `raised: false` attempt on the
  // on-demand path is what the ledger records as `skipped_deduped` (Q2).
  const deduped = toDispatchInput(rule(), raise({ raised: false, alarmId: null }));
  assert(deduped?.raised === false && deduped.alarmId === null, "raised and alarmId pass through");

  // `notification_deliveries.organization_id` is NOT NULL (0048) and the rule
  // is its only source, so a null-org rule has no valid input at all.
  assert(toDispatchInput(rule({ organizationId: null }), raise()) === null, "a null org builds nothing");
}

/**
 * ADR 0041 decision 1 / D3: dispatch is started and never awaited. The return
 * value says whether one was started — for these assertions, never for control
 * flow in a caller.
 */
export async function assertNotifyOnRaiseIsFireAndForget(): Promise<void> {
  // --- a notify rule dispatches exactly once, with the built input ----------
  {
    const { deps, calls, warns } = fakeDeps();
    const started = notifyOnRaise(deps, rule(), raise());
    assert(started === true, "a notify rule starts a dispatch");
    assert(calls.length === 1, `dispatch is called once, got ${calls.length}`);
    const expected = toDispatchInput(rule(), raise());
    assert(expected !== null, "fixture builds an input");
    for (const key of Object.keys(expected) as (keyof DispatchInput)[]) {
      assert(calls[0]?.[key] === expected[key], `dispatch received the built input (${key})`);
    }
    await tick();
    assert(warns.length === 0, `a resolving dispatch logs nothing, got: ${warns.join(" | ")}`);
  }

  // --- review and trace_only dispatch nothing --------------------------------
  for (const action of [
    { type: "review", target: "Operations" },
    { type: "trace_only", target: "Operations" },
  ]) {
    const { deps, calls, warns } = fakeDeps();
    const started = notifyOnRaise(deps, rule({ action }), raise());
    assert(started === false, `${action.type} starts no dispatch`);
    assert(calls.length === 0, `${action.type} must not call dispatch`);
    assert(warns.length === 0, `${action.type} is not a warning, it is the rule's choice`);
  }

  // --- a null-org notify rule dispatches nothing and says so once ------------
  {
    const { deps, calls, warns } = fakeDeps();
    const started = notifyOnRaise(deps, rule({ organizationId: null }), raise());
    assert(started === false, "a null-org rule starts no dispatch");
    assert(calls.length === 0, "a null-org rule must not call dispatch");
    assert(warns.length === 1, `exactly one warn for a null-org rule, got ${warns.length}`);
    assertWarnIsRedacted(warns[0] ?? "");
  }

  // --- a rejecting dispatch is caught: one warn, nothing thrown --------------
  //
  // `dispatch` never rejects (decision 1), so this is the belt for a fake or a
  // regression: the rejection must land in a warn, not in an unhandled promise
  // — Vitest fails the run on one of those, which is the second half of this
  // assertion.
  {
    const { deps, calls, warns } = fakeDeps(() => Promise.reject(new Error("boom: smtp down")));
    let threw = false;
    let started = false;
    try {
      started = notifyOnRaise(deps, rule(), raise());
    } catch {
      threw = true;
    }
    assert(!threw, "a rejecting dispatch must not throw into the raise loop");
    assert(started === true, "the dispatch was started before it rejected");
    assert(calls.length === 1, "the rejecting dispatch was called once");
    await until(() => warns.length === 1, { timeoutMs: 1_000, label: "one warn after rejection" });
    assert((warns[0] ?? "").includes("smtp down"), `the warn keeps the reason: ${String(warns[0])}`);
    assertWarnIsRedacted(warns[0] ?? "");
    await tick();
    assert(warns.length === 1, `still exactly one warn after settling, got ${warns.length}`);
  }

  // --- never awaited: a dispatch that never settles does not hold the caller --
  {
    const { deps, calls } = fakeDeps(() => new Promise<DispatchOutcome[]>(() => undefined));
    const started = notifyOnRaise(deps, rule(), raise());
    assert(started === true && calls.length === 1, "a pending dispatch still returns at once");
  }
}

/**
 * §9.6: a warn line carries the rule code and a reason only — never the alarm
 * text (which names an asset and a reading), a channel config or a recipient.
 */
function assertWarnIsRedacted(line: string): void {
  assert(line.includes("UPS-BATT-TEMP"), `the warn names the rule code: ${line}`);
  assert(!line.includes(MESSAGE), `the warn must not carry the message body: ${line}`);
  assert(!line.includes("48C"), `the warn must not carry the reading: ${line}`);
  assert(!line.includes(ORG_ID), `the warn must not carry the organization id: ${line}`);
}

/**
 * The poll helper Tasks 2 and 3 build their real-database assertions on. A
 * helper that hangs instead of failing would turn a missing ledger row into a
 * runner timeout that names nothing.
 */
export async function assertUntilFailsLoudly(): Promise<void> {
  let calls = 0;
  await until(() => ++calls >= 3, { intervalMs: 1 });
  assert(calls === 3, `until polls until the check holds, polled ${calls} times`);

  let caught: unknown;
  try {
    await until(() => false, { timeoutMs: 20, intervalMs: 5, label: "never" });
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof UntilTimeoutError, "a timeout throws UntilTimeoutError");
  assert(
    caught instanceof Error && caught.name === "UntilTimeoutError" && caught.message.includes("never"),
    `the error is named and carries the label: ${String(caught)}`,
  );

  // A throwing check is a spec bug, not a timeout — it propagates as-is.
  let propagated: unknown;
  try {
    await until(() => {
      throw new Error("spec bug");
    });
  } catch (err) {
    propagated = err;
  }
  assert(
    propagated instanceof Error && propagated.message === "spec bug",
    "a throwing check propagates its own error",
  );
}
