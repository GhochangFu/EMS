import { describe, it } from "vitest";

import {
  assertHeartbeatQueueIsFleet,
  assertHeartbeatQueueIsRegistered,
  assertHeartbeatQueueKeepsTheRetryDefaults,
  assertKeyStaysInsideThePrefixNamespace,
  assertNullTickIsStale,
  assertProcessorWritesTheInjectedClockAsIso,
  assertStaleBoundIsThreeTicksOfSixtySeconds,
  assertTickJustBeyondThreeTicksIsStale,
  assertTickJustInsideThreeTicksIsFresh,
  assertUnparseableTickIsStale,
} from "./heartbeat.spec";

/**
 * F4.24 (ADR 0063 decision 10) — Vitest entry point for the heartbeat queue.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file only
 * runs them.
 */
describe("F4.24 — heartbeat queue", () => {
  describe("heartbeatIsStale", () => {
    it("bounds staleness at three ticks of sixty seconds", () => {
      assertStaleBoundIsThreeTicksOfSixtySeconds();
    });

    it("reads a null tick as stale", () => {
      assertNullTickIsStale();
    });

    it("reads an unparseable tick as stale (fails closed on NaN)", () => {
      assertUnparseableTickIsStale();
    });

    it("reads a tick 179 999 ms old as fresh", () => {
      assertTickJustInsideThreeTicksIsFresh();
    });

    it("reads a tick 180 001 ms old as stale", () => {
      assertTickJustBeyondThreeTicksIsStale();
    });
  });

  describe("heartbeatProcessor", () => {
    it("writes the injected clock as an ISO instant through writeTick", async () => {
      await assertProcessorWritesTheInjectedClockAsIso();
    });
  });

  describe("declaration", () => {
    it("keys the tick under the queue prefix", () => {
      assertKeyStaysInsideThePrefixNamespace();
    });

    it("declares the queue as fleet", () => {
      assertHeartbeatQueueIsFleet();
    });

    it("keeps decision 7's retry defaults", () => {
      assertHeartbeatQueueKeepsTheRetryDefaults();
    });

    it("is listed in ALL_QUEUES", () => {
      assertHeartbeatQueueIsRegistered();
    });
  });
});
