import { describe, it } from "vitest";

import {
  assertCloseClosesEveryHandle,
  assertCompletedIncrementsTheCompletedCounter,
  assertCompletedIsCountedAgainstItsOwnQueue,
  assertErrorDoesNotCountAnOutcome,
  assertErrorWarnsAndDoesNotThrow,
  assertFailedIncrementsTheFailedCounter,
  assertFailedWarnDoesNotCarryTheErrorMessage,
  assertFailedWarnsNamingTheQueueAndTheErrorName,
  assertFailedWithoutAJobStillCountsAndWarns,
  assertOneWorkerPerRegistration,
  assertUnconfiguredClientCreatesNoWorker,
  assertUnconfiguredClientThrowsQueueUnavailable,
  assertWorkerOptionsCarryConnectionPrefixAndConcurrencyOne,
  assertWorkerRunsTheRegistrationsProcess,
} from "./worker-host.spec";

/**
 * F4.24 (ADR 0063 decisions 3, 9, 11) — Vitest entry point for the worker
 * host. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file
 * only runs them.
 */
describe("F4.24 — startQueueWorkers", () => {
  describe("unconfigured client (decision 9)", () => {
    it("throws QueueUnavailableError rather than starting nothing", () => {
      assertUnconfiguredClientThrowsQueueUnavailable();
    });

    it("creates no worker", () => {
      assertUnconfiguredClientCreatesNoWorker();
    });
  });

  describe("one Worker per registration", () => {
    it("creates one worker per registration, in order", () => {
      assertOneWorkerPerRegistration();
    });

    it("passes the client's connection, the bms prefix and concurrency 1", () => {
      assertWorkerOptionsCarryConnectionPrefixAndConcurrencyOne();
    });

    it("hands the Worker the registration's own process function", () => {
      assertWorkerRunsTheRegistrationsProcess();
    });
  });

  describe("completed (decision 11)", () => {
    it("increments bms_queue_jobs_total{queue,outcome=completed}", () => {
      assertCompletedIncrementsTheCompletedCounter();
    });

    it("counts under the queue whose worker completed", () => {
      assertCompletedIsCountedAgainstItsOwnQueue();
    });
  });

  describe("failed (decision 11)", () => {
    it("increments bms_queue_jobs_total{queue,outcome=failed}", () => {
      assertFailedIncrementsTheFailedCounter();
    });

    it("warns once, naming the queue and err.name", () => {
      assertFailedWarnsNamingTheQueueAndTheErrorName();
    });

    it("does not put err.message in the warn line", () => {
      assertFailedWarnDoesNotCarryTheErrorMessage();
    });

    it("still counts and warns when BullMQ hands it no job", () => {
      assertFailedWithoutAJobStillCountsAndWarns();
    });
  });

  describe("error", () => {
    it("warns naming the queue and does not throw", () => {
      assertErrorWarnsAndDoesNotThrow();
    });

    it("counts no job outcome", () => {
      assertErrorDoesNotCountAnOutcome();
    });
  });

  describe("close", () => {
    it("closes every worker handle", async () => {
      await assertCloseClosesEveryHandle();
    });
  });
});
