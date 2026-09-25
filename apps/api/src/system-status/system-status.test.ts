import { describe, it } from "vitest";

import {
  assertAllFreshIs100,
  assertAllOkIsOperational,
  assertDisconnectedQueueIsDegraded,
  assertHealthyQueueIsOk,
  assertNoFreshMqttAssetIsDegraded,
  assertNoMqttAssetIsNotMonitored,
  assertNotConfiguredAndNotMonitoredAreOperational,
  assertOneDegradedIsDegraded,
  assertOneFreshMqttAssetIsOk,
  assertOneOfThreeIs33Point3,
  assertReachableStorageIsOk,
  assertStaleHeartbeatQueueIsDegraded,
  assertUnconfiguredQueueIsNotConfigured,
  assertUnconfiguredStorageIsNotConfigured,
  assertUnreachableStorageIsDegraded,
  assertZeroStreamingIsNull,
} from "./system-status.spec";

/**
 * `F3.30` (ADR 0075 decisions 1, 3) — Vitest entry point for the pure system
 * status rules. Assertions live in the sibling `.spec` (§4.6/ADR 0014).
 */
describe("F3.30 — system status rules", () => {
  describe("queueComponentState", () => {
    it("an unconfigured queue reads not_configured", () => {
      assertUnconfiguredQueueIsNotConfigured();
    });

    it("a disconnected queue reads degraded", () => {
      assertDisconnectedQueueIsDegraded();
    });

    it("a stale heartbeat reads degraded", () => {
      assertStaleHeartbeatQueueIsDegraded();
    });

    it("a connected queue with a fresh heartbeat reads ok", () => {
      assertHealthyQueueIsOk();
    });
  });

  describe("storageComponentState", () => {
    it("unconfigured storage reads not_configured", () => {
      assertUnconfiguredStorageIsNotConfigured();
    });

    it("configured, unreachable storage reads degraded", () => {
      assertUnreachableStorageIsDegraded();
    });

    it("reachable storage reads ok", () => {
      assertReachableStorageIsOk();
    });
  });

  describe("fieldDataState", () => {
    it("no mqtt asset in scope reads not_monitored", () => {
      assertNoMqttAssetIsNotMonitored();
    });

    it("mqtt assets with none fresh read degraded", () => {
      assertNoFreshMqttAssetIsDegraded();
    });

    it("one fresh mqtt asset reads ok", () => {
      assertOneFreshMqttAssetIsOk();
    });
  });

  describe("verdict", () => {
    it("every component ok reads operational", () => {
      assertAllOkIsOperational();
    });

    it("one degraded component reads degraded", () => {
      assertOneDegradedIsDegraded();
    });

    it("not_configured and not_monitored only read operational", () => {
      assertNotConfiguredAndNotMonitoredAreOperational();
    });
  });

  describe("dataQualityPercent", () => {
    it("1 of 3 reads 33.3", () => {
      assertOneOfThreeIs33Point3();
    });

    it("0 of 0 reads null", () => {
      assertZeroStreamingIsNull();
    });

    it("152 of 152 reads 100", () => {
      assertAllFreshIs100();
    });
  });
});
