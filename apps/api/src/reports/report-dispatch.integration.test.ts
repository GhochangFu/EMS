import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertBothDueRowsAdvancedStrictlyPastNow,
  assertBothDueRowsStampLastRunAtNow,
  assertBothDueRowsWereEnqueuedOnce,
  assertTheDisabledRowIsNotAdvanced,
  assertTheDisabledRowIsNotEnqueued,
  assertTheLockedRowIsSkipped,
  assertTheNotDueRowIsUntouched,
  assertTheReleasedRowIsEnqueuedOnce,
  openDispatchFixtures,
  runDisabledRowScenario,
  runDueRowsScenario,
  runLockedRowScenario,
  type ClaimedFacts,
  type DisabledFacts,
  type DispatchIntegrationFixtures,
  type LockedFacts,
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
