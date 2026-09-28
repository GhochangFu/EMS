import { describe, it } from "vitest";

import {
  assertAnsweringPingIsReachable,
  assertASettledPingFreesTheSlot,
  assertConcurrentReadsShareOnePing,
  assertLivenessKeepsTheDatabaseThroughTheStorageVerdict,
  assertASettledReadLeavesNoPendingTimer,
  assertDegradedStaysDegradedBesideReachableDatabase,
  assertHangingPingIsUnreachableInsideTheTimeout,
  assertLivenessCarriesTheDatabaseAndStaysA200Body,
  assertOkAndReachableStaysOk,
  assertReachableIsReady,
  assertReadyAnswers200WhileTheDatabaseAnswers,
  assertReadyAnswers503WhileTheDatabaseIsDown,
  assertRejectingPingIsUnreachable,
  assertTheErrorTextNeverReachesTheBody,
  assertTheLivenessRouteTakesNoResponseObject,
  assertTheSectionIsCarriedIntoTheBody,
  assertUnreachableDatabaseDegrades,
  assertUnreachableIsNotReady,
} from "./database-health.spec";

/**
 * `F4.175` (ADR 0063 Amendment 3) — Vitest entry point for the database
 * health reader, the database half of the liveness verdict and
 * `GET /health/ready`. Assertions live in the sibling `.spec` (§4.6/ADR 0014);
 * this file only runs them. The hanging-ping row carries its own 2 s budget,
 * so a bound that stopped working fails here with a name printed.
 */
describe("F4.175 — database health", () => {
  describe("readDatabaseHealth", () => {
    it("reports reachable when the ping answers", async () => {
      await assertAnsweringPingIsReachable();
    });

    it("reports unreachable when the ping rejects", async () => {
      await assertRejectingPingIsUnreachable();
    });

    it("reports unreachable inside the timeout when the ping never answers", async () => {
      await assertHangingPingIsUnreachableInsideTheTimeout();
    }, 2_000);

    it("clears the timeout when the read settles", async () => {
      await assertASettledReadLeavesNoPendingTimer();
    });

    it("carries no connection detail from the error", async () => {
      await assertTheErrorTextNeverReachesTheBody();
    });
  });

  describe("withDatabaseVerdict", () => {
    it("leaves an ok body ok when the database is reachable", () => {
      assertOkAndReachableStaysOk();
    });

    it("reads an unreachable database as degraded", () => {
      assertUnreachableDatabaseDegrades();
    });

    it("keeps a degraded verdict beside a reachable database", () => {
      assertDegradedStaysDegradedBesideReachableDatabase();
    });

    it("carries the database section into the body and the queue section through", () => {
      assertTheSectionIsCarriedIntoTheBody();
    });
  });

  describe("readinessFrom", () => {
    it("is ready while the database is reachable", () => {
      assertReachableIsReady();
    });

    it("is not_ready while the database is unreachable", () => {
      assertUnreachableIsNotReady();
    });
  });

  describe("HealthController", () => {
    it("GET /health/ready answers 200 while the database answers", async () => {
      await assertReadyAnswers200WhileTheDatabaseAnswers();
    });

    it("GET /health/ready answers 503 while the database is down", async () => {
      await assertReadyAnswers503WhileTheDatabaseIsDown();
    });

    it("GET /health carries the database section and reads degraded", async () => {
      await assertLivenessCarriesTheDatabaseAndStaysA200Body();
    });

    it("GET /health takes no Response, so it cannot answer a non-200", () => {
      assertTheLivenessRouteTakesNoResponseObject();
    });

    it("GET /health keeps the database section through the storage verdict", async () => {
      await assertLivenessKeepsTheDatabaseThroughTheStorageVerdict();
    });
  });

  describe("DatabaseHealthService", () => {
    it("queues one select 1 however many reads arrive during a hung ping", async () => {
      await assertConcurrentReadsShareOnePing();
    });

    it("frees the slot once the ping settles", async () => {
      await assertASettledPingFreesTheSlot();
    });
  });
});
