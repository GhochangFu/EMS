import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationRedis } from "../testing/integration-redis-gate";
import {
  assertACorruptSweepKeyReadsAsNullNotDisconnected,
  assertAFreshTickIsNotStale,
  assertASlowReadCollapsesToDisconnected,
  assertASlowReadLeavesTheGaugeAlone,
  assertCompletedWasCountedOnce,
  assertDistinctJobIdRunsTheHandlerAgain,
  assertFailedWasCountedOnce,
  assertHandlerReceivedThePayload,
  assertHealthListsTheSweepQueue,
  assertHealthReadsBackTheRecordedSweep,
  assertHealthReportsTheFailure,
  assertHealthReportsTheQueueWithNoFailures,
  assertHealthReportsTheTick,
  assertHeartbeatCompletionWasCounted,
  assertLivenessIsOk,
  assertSameJobIdTwiceRunsTheHandlerOnce,
  assertTheFailedJobIsStillInRedis,
  assertTheFailureWarnNamesTheClassNotTheMessage,
  assertTheHeartbeatKeptFiringBesideTheSweep,
  assertTheSweepSchedulerRanTheProcessorRepeatedly,
  assertTheTickIsAnInstant,
  assertTheTimeoutFiredWithinItsBudget,
  closeQueueSuite,
  openQueueSuite,
  runDedupe,
  runFailingHandler,
  runHeartbeat,
  runRoundTrip,
  runRuleSweepSchedule,
  runRuleSweepSummary,
  runTimeoutGuard,
  type DedupeOutcome,
  type FailingOutcome,
  type HeartbeatOutcome,
  type QueueSuite,
  type RoundTripOutcome,
  type RuleSweepScheduleOutcome,
  type RuleSweepSummaryOutcome,
  type TimeoutOutcome,
} from "./queue.integration.spec";

/**
 * F4.24 (ADR 0063 decision 13) — Vitest entry point for the queue pipeline
 * against a real Redis. Gated like every `*.integration.test.ts`: skipped
 * locally without `REDIS_URL` (with the gate's stderr line), refused under
 * `CI`, and a set-but-unreachable URL fails rather than skips.
 *
 * Each row of plan §9's table is a nested `describe`: the scenario runs once
 * in its `beforeAll` (bounded by `until`), and each claim is its own `it()`
 * so a later assertion is never hidden behind an earlier throw. The rows run
 * in order against one worker set; every count is a delta on the row's own
 * queue. `F3.11` (ADR 0064 decisions 2, 8) adds two rows after the heartbeat's:
 * the `rules-sweep` scheduler firing beside it, and the last-sweep key read
 * back through health.
 */
const redisUrl = requireIntegrationRedis({
  item: "F4.24",
  label: "queue integration tests",
  because:
    "they are the only proof that enqueue → a real BullMQ Worker → readQueueHealth agree on " +
    "a live Redis: that a duplicate jobId is one job (decision 5), that a failed job is " +
    "counted and retained (decision 7), that the heartbeat scheduler fires and health " +
    "reads its tick (decision 10), that a second scheduler (rules-sweep, ADR 0064) fires " +
    "beside it and its last-sweep key reads back through health, and that a read slower " +
    "than its budget answers connected: false rather than hanging the liveness probe.",
});

const ROW_TIMEOUT_MS = 15_000;

describe.skipIf(!redisUrl)("F4.24 — queue pipeline against a real Redis", () => {
  let suite: QueueSuite;

  beforeAll(async () => {
    suite = await openQueueSuite(redisUrl as string, `bms-test-${process.pid}-${Date.now()}`);
  }, ROW_TIMEOUT_MS);

  afterAll(async () => {
    if (suite !== undefined) {
      await closeQueueSuite(suite);
    }
  }, ROW_TIMEOUT_MS);

  describe("enqueue → worker → health (the round trip)", () => {
    let outcome: RoundTripOutcome;
    beforeAll(async () => {
      outcome = await runRoundTrip(suite);
    }, ROW_TIMEOUT_MS);

    it("delivers the payload to the handler", () => {
      assertHandlerReceivedThePayload(outcome);
    });

    it("reports the queue with failed: 0", () => {
      assertHealthReportsTheQueueWithNoFailures(outcome);
    });

    it("counts (q, completed) once", () => {
      assertCompletedWasCountedOnce(outcome);
    });
  });

  describe("the same jobId twice (decision 5)", () => {
    let outcome: DedupeOutcome;
    beforeAll(async () => {
      outcome = await runDedupe(suite);
    }, ROW_TIMEOUT_MS);

    it("runs the handler once", () => {
      assertSameJobIdTwiceRunsTheHandlerOnce(outcome);
    });

    it("runs it again for a distinct jobId (positive control)", () => {
      assertDistinctJobIdRunsTheHandlerAgain(outcome);
    });
  });

  describe("a handler that throws, attempts: 1 (decision 7)", () => {
    let outcome: FailingOutcome;
    beforeAll(async () => {
      outcome = await runFailingHandler(suite);
    }, ROW_TIMEOUT_MS);

    it("reports failed: 1 on the queue", () => {
      assertHealthReportsTheFailure(outcome);
    });

    it("counts (q2, failed) once", () => {
      assertFailedWasCountedOnce(outcome);
    });

    it("keeps the failed job in Redis a second later", () => {
      assertTheFailedJobIsStillInRedis(outcome);
    });

    it("warns with the error's class and not its message", () => {
      assertTheFailureWarnNamesTheClassNotTheMessage(outcome);
    });
  });

  describe("the heartbeat scheduler (decision 10)", () => {
    let outcome: HeartbeatOutcome;
    beforeAll(async () => {
      outcome = await runHeartbeat(suite);
    }, ROW_TIMEOUT_MS);

    it("writes an ISO-8601 tick", () => {
      assertTheTickIsAnInstant(outcome);
    });

    it("reports lastHeartbeatAt", () => {
      assertHealthReportsTheTick(outcome);
    });

    it("reads a fresh tick as not stale", () => {
      assertAFreshTickIsNotStale(outcome);
    });

    it("answers liveness ok", () => {
      assertLivenessIsOk(outcome);
    });

    it("counts (heartbeat, completed)", () => {
      assertHeartbeatCompletionWasCounted(outcome);
    });
  });

  describe("the rules-sweep scheduler beside the heartbeat's (ADR 0064 decision 2)", () => {
    let outcome: RuleSweepScheduleOutcome;
    beforeAll(async () => {
      outcome = await runRuleSweepSchedule(suite);
    }, ROW_TIMEOUT_MS);

    it("runs the rules-sweep processor at least twice within 5 s", () => {
      assertTheSweepSchedulerRanTheProcessorRepeatedly(outcome);
    });

    it("keeps the heartbeat firing in the same window (two schedulers coexist)", () => {
      assertTheHeartbeatKeptFiringBesideTheSweep(outcome);
    });

    it("lists rules-sweep in health", () => {
      assertHealthListsTheSweepQueue(outcome);
    });
  });

  describe("the last-sweep key (ADR 0064 decision 8)", () => {
    let outcome: RuleSweepSummaryOutcome;
    beforeAll(async () => {
      outcome = await runRuleSweepSummary(suite);
    }, ROW_TIMEOUT_MS);

    it("reads back through health as lastRuleSweep", () => {
      assertHealthReadsBackTheRecordedSweep(outcome);
    });

    it("reads garbage on the key as null, still connected", () => {
      assertACorruptSweepKeyReadsAsNullNotDisconnected(outcome);
    });
  });

  describe("a read slower than its budget (the hang guard)", () => {
    let outcome: TimeoutOutcome;
    beforeAll(async () => {
      outcome = await runTimeoutGuard(suite);
    }, ROW_TIMEOUT_MS);

    it("collapses to connected: false", () => {
      assertASlowReadCollapsesToDisconnected(outcome);
    });

    it("returns on the timer, not on the blocked read", () => {
      assertTheTimeoutFiredWithinItsBudget(outcome);
    });

    it("publishes no depth gauge", () => {
      assertASlowReadLeavesTheGaugeAlone(outcome);
    });
  });
});
