import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertBothDueRowsAdvancedStrictlyPastNow,
  assertBothDueRowsStampLastRunAtNow,
  assertBothDueRowsWereEnqueuedOnce,
  assertEveryPoisonRowIsDeferredPastNowAfterTickOne,
  assertPoisonRowsAreDeferredExactlyOneHourAndOtherwiseUntouched,
  assertTheDisabledRowIsNotAdvanced,
  assertTheDisabledRowIsNotEnqueued,
  assertTheLockedRowIsSkipped,
  assertTheNotDueRowIsUntouched,
  assertTheReleasedRowIsEnqueuedOnce,
  assertTickOneSkippedThePoisonRowsAndDidNotReachPhewb,
  assertTickTwoEnqueuesThePhewbRowOnceAndAdvancesIt,
  openDispatchFixtures,
  runDisabledRowScenario,
  runDueRowsScenario,
  runLockedRowScenario,
  runPoisonRowsScenario,
  type ClaimedFacts,
  type DisabledFacts,
  type DispatchIntegrationFixtures,
  type LockedFacts,
  type PoisonFacts,
} from "./report-dispatch.integration.spec";

/**
 * `F3.5b` U9 — Vitest entry point for the dispatch tick against Postgres.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file owns
 * the lifecycle: the pool. The one committed locked-row fixture lives and
 * dies inside `runLockedRowScenario` (step-5 finding: a fixture committed in
 * `beforeAll` is claimed by the compose worker). Each scenario runs once in
 * a `beforeAll` and its facts are read by one claim per `it()`.
 */
const connectionString = requireIntegrationDb({
  item: "F3.5b",
  label: "report dispatch integration tests",
  because:
    "these are the only tests that prove the claim predicate against real rows — that a due, " +
    "enabled row is claimed and advanced past now with last_run_at stamped, that a not-due or " +
    "disabled row is left alone, and that FOR UPDATE SKIP LOCKED skips a row another transaction " +
    "holds. The unit spec runs over fakes and passes with the SQL text wrong.",
});

describe.skipIf(!connectionString)("F3.5b — ReportDispatchService.tick against Postgres: the claim, the advance, SKIP LOCKED", () => {
  let fx: DispatchIntegrationFixtures;

  beforeAll(async () => {
    fx = await openDispatchFixtures(connectionString as string, "F3.5b");
  });

  afterAll(async () => {
    await fx?.close();
  });

  describe("dueRowsAreClaimedAndAdvanced", () => {
    let facts: ClaimedFacts;

    beforeAll(async () => {
      facts = await runDueRowsScenario(fx);
    });

    it("enqueues each of the two due rows exactly once (the savepoint sees the case's own inserts)", () => {
      assertBothDueRowsWereEnqueuedOnce(facts);
    });

    it("moves both due rows' next_run_at strictly past now", () => {
      assertBothDueRowsAdvancedStrictlyPastNow(facts);
    });

    it("stamps both due rows' last_run_at = now", () => {
      assertBothDueRowsStampLastRunAtNow(facts);
    });

    it("leaves the not-due row neither enqueued nor advanced", () => {
      assertTheNotDueRowIsUntouched(facts);
    });
  });

  describe("aDisabledRowIsNotClaimed", () => {
    let facts: DisabledFacts;

    beforeAll(async () => {
      facts = await runDisabledRowScenario(fx);
    });

    it("does not enqueue the disabled row", () => {
      assertTheDisabledRowIsNotEnqueued(facts);
    });

    it("does not advance the disabled row", () => {
      assertTheDisabledRowIsNotAdvanced(facts);
    });
  });

  describe("poisonRowsAreDeferredSoTheOtherTenantIsClaimedOnTickTwo — tick 1 fills LIMIT 200 with them, tick 2 at the same now reaches PHEWB (Amendment 2 item 7 C)", () => {
    let facts: PoisonFacts;

    beforeAll(async () => {
      facts = await runPoisonRowsScenario(fx);
    });

    it("tick 1 skipped the poison rows and did not reach PHEWB (negative control: the claim was full of them)", () => {
      assertTickOneSkippedThePoisonRowsAndDidNotReachPhewb(facts);
    });

    it("after tick 1 every one of the 200 poison rows is past now", () => {
      assertEveryPoisonRowIsDeferredPastNowAfterTickOne(facts);
    });

    it("the deferral is exactly one hour; last_run_at stays null and enabled stays true", () => {
      assertPoisonRowsAreDeferredExactlyOneHourAndOtherwiseUntouched(facts);
    });

    it("tick 2 enqueues the PHEWB row exactly once and advances it — the other tenant is no longer starved", () => {
      assertTickTwoEnqueuesThePhewbRowOnceAndAdvancesIt(facts);
    });
  });

  describe("aRowLockedByAnotherTransactionIsSkipped", () => {
    let facts: LockedFacts;

    beforeAll(async () => {
      facts = await runLockedRowScenario(fx);
    });

    it("skips the row connection A holds FOR UPDATE", () => {
      assertTheLockedRowIsSkipped(facts);
    });

    it("enqueues the same row once when connection A has released it (positive control)", () => {
      assertTheReleasedRowIsEnqueuedOnce(facts);
    });
  });
});
