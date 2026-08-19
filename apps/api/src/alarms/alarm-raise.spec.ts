import {
  isSampleFreshEnoughToRaise,
  MAX_RAISE_CLOCK_SKEW_MS,
  MAX_RAISE_SAMPLE_AGE_MS,
  shouldRaise,
} from "./alarm-raise.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `shouldRaise` is where "time-window rules never raise alarms" stops being
 * implicit in `AlarmEngineService`'s cache-loading `WHERE ruleType =
 * 'threshold'` and becomes an explicit decision, reachable by any evaluator
 * (F3.6 task 5's `RulesService.evaluateEnabledRules` included).
 */
function testShouldRaise(): void {
  assert(
    shouldRaise({ ruleType: "threshold" }, { matched: true }),
    "a matched threshold rule must raise",
  );
  assert(
    !shouldRaise({ ruleType: "threshold" }, { matched: false }),
    "a threshold rule that did not match must not raise",
  );

  // The decision this function exists to make explicit.
  assert(
    !shouldRaise({ ruleType: "time_window" }, { matched: true }),
    "a matched time-window rule must NOT raise — matching its schedule is a " +
      "fact for F3.7's notification actions to read, not an alarm condition",
  );
  assert(
    !shouldRaise({ ruleType: "time_window" }, { matched: false }),
    "an unmatched time-window rule must not raise either",
  );

  // A future/unsupported rule type defaults to not raising, matching
  // `unsupportedRuleType`'s "error, not a crash" posture in rule-evaluation.ts.
  assert(
    !shouldRaise({ ruleType: "anomaly" }, { matched: true }),
    "an unsupported rule type must not raise even if something marked it matched",
  );
}

/**
 * `isSampleFreshEnoughToRaise` gates the on-demand path's raise, separately
 * from `shouldRaise` — a security-review finding (F3.6): a sample can be up
 * to 730 days old (ADR 0024 retention) and still be the "latest" one for an
 * asset that stopped reporting.
 */
function testIsSampleFreshEnoughToRaise(): void {
  const now = new Date("2026-08-19T12:00:00.000Z");

  assert(
    isSampleFreshEnoughToRaise(now, now),
    "a sample from this instant must be fresh enough to raise",
  );
  assert(
    isSampleFreshEnoughToRaise(
      new Date(now.getTime() - MAX_RAISE_SAMPLE_AGE_MS),
      now,
    ),
    "a sample exactly at the age bound must still be fresh enough to raise",
  );
  assert(
    !isSampleFreshEnoughToRaise(
      new Date(now.getTime() - MAX_RAISE_SAMPLE_AGE_MS - 1),
      now,
    ),
    "a sample one millisecond past the age bound must not be fresh enough to raise",
  );
  assert(
    !isSampleFreshEnoughToRaise(
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      now,
    ),
    "a month-old sample — an offline or decommissioned asset's last reading — must not raise",
  );

  // Code review and security review, PR #100: a one-sided `now - sampleTime
  // <= MAX` check treats every future-dated sample as infinitely fresh (the
  // difference is negative). Real, not hypothetical — the pilot RTU's clock
  // has been measured running ~34 minutes ahead of the server.
  assert(
    isSampleFreshEnoughToRaise(
      new Date(now.getTime() + 34 * 60 * 1000),
      now,
    ),
    "a sample 34 minutes ahead of the server clock — the documented pilot RTU skew — must still raise",
  );
  assert(
    isSampleFreshEnoughToRaise(
      new Date(now.getTime() + MAX_RAISE_CLOCK_SKEW_MS),
      now,
    ),
    "a sample exactly at the clock-skew bound must still be fresh enough to raise",
  );
  assert(
    !isSampleFreshEnoughToRaise(
      new Date(now.getTime() + MAX_RAISE_CLOCK_SKEW_MS + 1),
      now,
    ),
    "a sample one millisecond past the clock-skew bound must not be fresh enough to raise",
  );
  assert(
    !isSampleFreshEnoughToRaise(
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      now,
    ),
    "a sample a week in the future — an implausible clock, not ordinary skew — must not raise " +
      "(the exact hole a one-sided bound leaves open: a dead asset's last, future-dated sample " +
      "would otherwise stay \"fresh\" until real time catches up to it)",
  );
}

/** Assertions for `shouldRaise` and `isSampleFreshEnoughToRaise` (F3.6). */
export function runAlarmRaiseTests(): void {
  testShouldRaise();
  testIsSampleFreshEnoughToRaise();
}
