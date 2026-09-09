import { describe, it } from "vitest";

import {
  runAlarmLifecycleTests,
  testAStepOneMinutePastDueIsNotStale,
  testExactlyTheBoundIsNotStale,
  testLatenessIsMeasuredFromTheDueInstant,
  testOneMillisecondPastTheBoundIsStale,
  testTheStaleFlagRidesOnTheEvent,
  testTheStaleFlagStaysOutOfTheDedupeKey,
} from "./alarm-lifecycle.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-lifecycle", () => {
  it("decides the clear from the hold, the due steps from raised_at, and builds both event inputs from the alarm's own severity", () => {
    runAlarmLifecycleTests();
  });
});

/**
 * `F3.52` — one `it()` per assertion, so a mutation can be shown to redden the
 * case that owns it and no other (ADR 0041 Amendment 6 §2).
 */
describe("F3.52 a due escalation step can be too late to send", () => {
  it("calls a step one minute past due late, not stale", () => {
    testAStepOneMinutePastDueIsNotStale();
  });

  it("still sends at exactly the bound — the comparison is >, not >=", () => {
    testExactlyTheBoundIsNotStale();
  });

  it("abandons the step one millisecond over the bound", () => {
    testOneMillisecondPastTheBoundIsStale();
  });

  it("measures the lateness from the step's due instant, not from raised_at", () => {
    testLatenessIsMeasuredFromTheDueInstant();
  });

  it("puts the flag on the escalation event only when the caller says so", () => {
    testTheStaleFlagRidesOnTheEvent();
  });

  it("keeps the flag out of the dedupe key", () => {
    testTheStaleFlagStaysOutOfTheDedupeKey();
  });
});
