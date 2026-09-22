import { afterEach, beforeAll, describe, it, vi } from "vitest";

import type { ReportDispatchSummary } from "./report-dispatch.service";
import {
  assertDueCountsTheClaimedRowsOnly,
  assertEachAddCarriesTheRowsPeriodAndJobId,
  assertEachUpdateAdvancesToNextRunAtFromNow,
  assertLateTickAdvancesStrictlyPastNow,
  assertLateTickEnqueuesOncePeriodBeforeTheDueInstant,
  assertNoUpdateWasRecordedAfterTheEnqueueFailure,
  assertPoisonDeferralIsWrittenAfterEveryAdd,
  assertPoisonRowIsDeferredAnHourAndNothingElseMoves,
  assertPoisonRowIsCountedSkippedInvalid,
  assertPoisonRowWarnNeverNamesTheZone,
  assertPoisonRowWarnsOnceWithIdAndErrorName,
  assertRecordedOrderIsSelectThenAddsThenUpdates,
  assertSummaryCountsTwoDueTwoEnqueued,
  assertTheBackoffIsOneHour,
  assertTheClaimCarriesTheLimit,
  assertTheOtherRowIsStillEnqueued,
  assertTickRejectedWithTheEnqueueError,
  assertUnparsableTimestampEnqueuesAndAdvancesNothing,
  assertUnparsableTimestampRejectsTheTick,
  DUE_ROWS,
  LATE_ROW,
  makeHarness,
  NOW,
  overTheLimitRows,
  POISON_ROW,
  UNPARSABLE_ROW,
  type DispatchHarness,
} from "./report-dispatch.service.spec";

/**
 * `F3.5b` U9 — Vitest entry point for `ReportDispatchService.tick` over
 * fakes. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file
 * only runs them, one claim per `it()`.
 */
describe("F3.5b — ReportDispatchService.tick: enqueue before advance, the poison row, the aborted tick, the late tick", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enqueuesOnePerDueRowThenAdvances", () => {
    let h: DispatchHarness;
    let summary: ReportDispatchSummary;

    beforeAll(async () => {
      h = makeHarness(DUE_ROWS);
      summary = await h.service.tick(h.fleetDb, NOW);
    });

    it("records exactly [select, add, add, update, update]", () => {
      assertRecordedOrderIsSelectThenAddsThenUpdates(h);
    });

    it("each add carries renderJobId(id, periodEnd) and the period of the row's next_run_at", () => {
      assertEachAddCarriesTheRowsPeriodAndJobId(h);
    });

    it("each update's next_run_at equals nextRunAt(row, now)", () => {
      assertEachUpdateAdvancesToNextRunAtFromNow(h);
    });

    it("the summary counts two due, two enqueued, none skipped", () => {
      assertSummaryCountsTwoDueTwoEnqueued(summary);
    });

    it("the claim carries LIMIT bound to REPORT_DISPATCH_CLAIM_LIMIT (step-5 finding)", () => {
      assertTheClaimCarriesTheLimit(h);
    });
  });

  describe("aTickOverTheClaimLimitLeavesTheRestForTheNextTick", () => {
    let summary: ReportDispatchSummary;

    beforeAll(async () => {
      const h = makeHarness(overTheLimitRows());
      summary = await h.service.tick(h.fleetDb, NOW);
    });

    it("due and enqueued equal the claim limit with one row over it", () => {
      assertDueCountsTheClaimedRowsOnly(summary);
    });
  });

  describe("aPoisonRowIsCountedWarnedAndDeferredAnHour", () => {
    let h: DispatchHarness;
    let summary: ReportDispatchSummary;

    beforeAll(async () => {
      h = makeHarness([DUE_ROWS[0] as (typeof DUE_ROWS)[number], POISON_ROW]);
      summary = await h.service.tick(h.fleetDb, NOW);
    });

    it("counts skippedInvalid === 1", () => {
      assertPoisonRowIsCountedSkippedInvalid(summary);
    });

    it("defers the poison row one hour with one update that sets next_run_at only (item 7 C)", () => {
      assertPoisonRowIsDeferredAnHourAndNothingElseMoves(h);
    });

    it("writes the deferral after every add, beside the advances", () => {
      assertPoisonDeferralIsWrittenAfterEveryAdd(h);
    });

    it("the backoff constant is one hour", () => {
      assertTheBackoffIsOneHour();
    });

    it("warns exactly once naming the schedule id and ReportPeriodError", () => {
      assertPoisonRowWarnsOnceWithIdAndErrorName(h);
    });

    it("never names the zone string in a warn", () => {
      assertPoisonRowWarnNeverNamesTheZone(h);
    });

    it("still enqueues the healthy row", () => {
      assertTheOtherRowIsStillEnqueued(h);
    });
  });

  describe("anEnqueueFailureAbortsTheTick", () => {
    const boom = new Error("redis is away");
    let h: DispatchHarness;
    let rejection: unknown;

    beforeAll(async () => {
      h = makeHarness(DUE_ROWS, { addRejects: boom });
      rejection = await h.service.tick(h.fleetDb, NOW).then(
        () => undefined,
        (err: unknown) => err,
      );
    });

    it("tick rejects with the enqueue error", () => {
      assertTickRejectedWithTheEnqueueError(rejection, boom);
    });

    it("records zero updates", () => {
      assertNoUpdateWasRecordedAfterTheEnqueueFailure(h);
    });
  });

  describe("aDriverTimestampThatDoesNotParseAbortsTheTick", () => {
    let h: DispatchHarness;
    let rejection: unknown;

    beforeAll(async () => {
      h = makeHarness([UNPARSABLE_ROW]);
      rejection = await h.service.tick(h.fleetDb, NOW).then(
        () => undefined,
        (err: unknown) => err,
      );
    });

    it("tick rejects naming the schedule id — a driver contract failure is not a poison row", () => {
      assertUnparsableTimestampRejectsTheTick(rejection);
    });

    it("enqueues and advances nothing", () => {
      assertUnparsableTimestampEnqueuesAndAdvancesNothing(h);
    });
  });

  describe("aLateTickCoversThePeriodBeforeTheDueInstant", () => {
    let h: DispatchHarness;

    beforeAll(async () => {
      h = makeHarness([LATE_ROW]);
      await h.service.tick(h.fleetDb, NOW);
    });

    it("enqueues once, for the period ending before the due instant", () => {
      assertLateTickEnqueuesOncePeriodBeforeTheDueInstant(h);
    });

    it("advances next_run_at strictly past now", () => {
      assertLateTickAdvancesStrictlyPastNow(h);
    });
  });
});
