import { describe, it } from "vitest";

import {
  runAlarmLifecycleTests,
  testADeferredFirstDeliveryCarriesItsAge,
  testAFutureRaisedAtRendersNoClause,
  testAStepOneMinutePastDueIsNotStale,
  testAnUnparseableRaisedAtRendersNoClause,
  testExactlyTheBoundIsNotStale,
  testLatenessIsMeasuredFromTheDueInstant,
  testNoClauseUnderAWholeMinute,
  testOneMillisecondPastTheBoundIsStale,
  testTheAgeStaysOutOfTheDedupeKey,
  testTheClauseAppearsAtExactlyOneMinute,
  testTheStaleFlagRidesOnTheEvent,
  testTheStaleFlagStaysOutOfTheDedupeKey,
  testTheSubjectStaysTheRaisesOwn,
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

/**
 * `F3.57` — the re-offered raise carries the alarm's age (ADR 0041 Amendment 9,
 * ADR 0057 Amendment 8). One `it()` per assertion, following `F3.52`.
 */
describe("F3.57 a re-offered raise says how long the alarm has been open", () => {
  it("says nothing under a whole minute — the common case is the very next tick", () => {
    testNoClauseUnderAWholeMinute();
  });

  it("appends the clause at exactly one whole minute", () => {
    testTheClauseAppearsAtExactlyOneMinute();
  });

  it("says nothing for a raised_at in the future — the guard fails closed on a skewed clock", () => {
    testAFutureRaisedAtRendersNoClause();
  });

  it("says nothing for an unparseable raised_at, never \"NaN min\"", () => {
    testAnUnparseableRaisedAtRendersNoClause();
  });

  it("tells an hour-old first delivery that it is an hour old", () => {
    testADeferredFirstDeliveryCarriesItsAge();
  });

  it("keeps the age out of the dedupe key — two bodies, one key", () => {
    testTheAgeStaysOutOfTheDedupeKey();
  });

  it("leaves the subject byte-identical, so a subject-grouping mail client keeps the two together", () => {
    testTheSubjectStaysTheRaisesOwn();
  });
});
