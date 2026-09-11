import { describe, it } from "vitest";

import {
  assertAbsentSweepKeyReadsAsConnected,
  assertAbsentSweepKeyReadsNull,
  assertConfiguredReadReportsConnected,
  assertConnectedAndFreshIsOk,
  assertCountsAreMappedByQueueName,
  assertDisconnectedIsDegraded,
  assertFreshTickIsReportedAndNotStale,
  assertGarbageSweepKeyIsNotADisconnection,
  assertGarbageSweepKeyReadsNull,
  assertGaugeIsSetOncePerQueueAndState,
  assertHangingCountsLeaveTheGaugeAlone,
  assertHangingCountsReadAsDisconnectedInsideTheTimeout,
  assertLivenessCarriesTheQueueSectionUnchanged,
  assertNeitherQueueMetricCarriesTheApiPrefix,
  assertNeitherSweepMetricCarriesTheApiPrefix,
  assertNullSweepWithFreshHeartbeatIsOk,
  assertNullTickIsReportedNullAndStale,
  assertOldTickIsReportedAndStale,
  assertQueueDepthGaugeRegistersUnderItsAdrName,
  assertQueueJobsCounterRegistersUnderItsAdrName,
  assertRejectingCountsLeaveTheGaugeAlone,
  assertRejectingCountsReadAsDisconnected,
  assertRejectingSweepReadsAsDisconnected,
  assertRejectingTickReadsAsDisconnected,
  assertRuleSweepDurationHistogramObservesTheSeconds,
  assertRuleSweepRaisedCounterAddsTheRaisedCount,
  assertStaleIsDegraded,
  assertUnconfiguredIsOk,
  assertUnconfiguredShapeIsExact,
  assertValidSweepIsReportedAsWritten,
  assertValidSweepReadsAsConnected,
} from "./queue-health.spec";

/**
 * F4.24 (ADR 0063 decisions 10, 11) — Vitest entry point for the queue
 * health reader, the liveness verdict and the two queue metrics; since
 * F3.11 (ADR 0064 decision 8) also the `lastRuleSweep` field and the two
 * sweep metrics. Assertions live in the sibling `.spec` (§4.6/ADR 0014);
 * this file only runs them. The two timeout rows carry their own 2 s
 * budget so a hang guard that stopped working fails here, not at vitest's
 * default.
 */
describe("F4.24 — queue health", () => {
  describe("readQueueHealth, unconfigured", () => {
    it("returns the exact unconfigured shape", async () => {
      await assertUnconfiguredShapeIsExact();
    });
  });

  describe("readQueueHealth, configured", () => {
    it("reports connected when every read resolves", async () => {
      await assertConfiguredReadReportsConnected();
    });

    it("maps each queue's counts by name", async () => {
      await assertCountsAreMappedByQueueName();
    });

    it("sets the depth gauge once per queue and state", async () => {
      await assertGaugeIsSetOncePerQueueAndState();
    });

    it("reports a fresh tick and heartbeatStale false", async () => {
      await assertFreshTickIsReportedAndNotStale();
    });

    it("reports an old tick and heartbeatStale true", async () => {
      await assertOldTickIsReportedAndStale();
    });

    it("reports a null tick as null and heartbeatStale true (ruling 5)", async () => {
      await assertNullTickIsReportedNullAndStale();
    });

    it("reads as disconnected when a getJobCounts rejects", async () => {
      await assertRejectingCountsReadAsDisconnected();
    });

    it("leaves the gauge alone when a getJobCounts rejects", async () => {
      await assertRejectingCountsLeaveTheGaugeAlone();
    });

    it("reads as disconnected when readTick rejects", async () => {
      await assertRejectingTickReadsAsDisconnected();
    });

    it("reads as disconnected inside the timeout when a getJobCounts never resolves", async () => {
      await assertHangingCountsReadAsDisconnectedInsideTheTimeout();
    }, 2_000);

    it("leaves the gauge alone when the read times out", async () => {
      await assertHangingCountsLeaveTheGaugeAlone();
    }, 2_000);
  });

  describe("readQueueHealth, the sweep summary (F3.11)", () => {
    it("reports a valid sweep key as written", async () => {
      await assertValidSweepIsReportedAsWritten();
    });

    it("reads as connected beside a valid sweep key", async () => {
      await assertValidSweepReadsAsConnected();
    });

    it("reports an absent sweep key as null", async () => {
      await assertAbsentSweepKeyReadsNull();
    });

    it("reads as connected beside an absent sweep key", async () => {
      await assertAbsentSweepKeyReadsAsConnected();
    });

    it("reports a corrupt sweep key as null", async () => {
      await assertGarbageSweepKeyReadsNull();
    });

    it("does not read a corrupt sweep key as a disconnection", async () => {
      await assertGarbageSweepKeyIsNotADisconnection();
    });

    it("reads as disconnected when readSweep rejects", async () => {
      await assertRejectingSweepReadsAsDisconnected();
    });
  });

  describe("livenessFrom", () => {
    it("reads a null sweep beside a fresh heartbeat as ok (the field does not decide)", () => {
      assertNullSweepWithFreshHeartbeatIsOk();
    });

    it("reads unconfigured as ok", () => {
      assertUnconfiguredIsOk();
    });

    it("reads configured, connected and fresh as ok", () => {
      assertConnectedAndFreshIsOk();
    });

    it("reads disconnected as degraded", () => {
      assertDisconnectedIsDegraded();
    });

    it("reads a stale heartbeat as degraded", () => {
      assertStaleIsDegraded();
    });

    it("carries the queue section unchanged", () => {
      assertLivenessCarriesTheQueueSectionUnchanged();
    });
  });

  describe("MetricsService (decision 11)", () => {
    it("registers bms_queue_depth{queue,state} and sets it", async () => {
      await assertQueueDepthGaugeRegistersUnderItsAdrName();
    });

    it("registers bms_queue_jobs_total{queue,outcome} and increments it", async () => {
      await assertQueueJobsCounterRegistersUnderItsAdrName();
    });

    it("carries no bms_api_ prefix on either queue metric", async () => {
      await assertNeitherQueueMetricCarriesTheApiPrefix();
    });
  });

  describe("MetricsService (ADR 0064 decision 8)", () => {
    it("observes the sweep duration in seconds on bms_rule_sweep_duration_seconds", async () => {
      await assertRuleSweepDurationHistogramObservesTheSeconds();
    });

    it("adds the raised count to bms_rule_sweep_raised_total", async () => {
      await assertRuleSweepRaisedCounterAddsTheRaisedCount();
    });

    it("carries no bms_api_ prefix on either sweep metric", async () => {
      await assertNeitherSweepMetricCarriesTheApiPrefix();
    });
  });
});
