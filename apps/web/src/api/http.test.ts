// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
  runACurrent401StillClearsAndRecords,
  runALate401LeavesTheNewSession,
  runALate401RecordsNoReason,
  runAnAnonymous401LeavesALaterSession,
  runAStale401StoresNoReturnPath,
  runASessionSetDuringThe401BodyReadRecordsNothing,
  runAStreamed401BodyWithNoNewSessionRecordsTheReason,
  runALaterPlain401DoesNotEraseTheReason,
  runAnUnclonableResponseStillClearsTheSession,
  runANonJsonBodyIsIgnored,
  runAReadBodyStillClearsTheSession,
  runDeactivated401RecordsTheReason,
  runPlain401RecordsNoReason,
  runSetSessionConsumesTheReason,
  runTheCallerCanStillReadTheBody,
  runTheStoreKeepsTheFirstReason,
  runAuthFailureTests,
  runLater401KeepsReturnPathTest,
  runLater401WithTheOldBearerKeepsReturnPathTest,
  runNoReturnPathOffWallTest,
  runNoReturnPathOn403Test,
  runWallReturnPathOn401Test,
  runWithAuthTests,
} from "./http.spec";

/**
 * Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014).
 * jsdom since `F3.77`: the 401 path reads `window.location` and writes
 * `sessionStorage` (plan D10).
 */
describe("api/http", () => {
  it("clears the session on 401 and keeps it on 403", () => {
    runAuthFailureTests();
  });

  it("H1 a 401 on a wall URL stores the return path and clears the session", () => {
    runWallReturnPathOn401Test();
  });

  it("H2 a 401 off a wall URL stores no return path", () => {
    runNoReturnPathOffWallTest();
  });

  it("H3 a 403 on a wall URL stores no return path and keeps the session", () => {
    runNoReturnPathOn403Test();
  });

  it("H4 a later 401 on /login keeps the stored wall URL", () => {
    runLater401KeepsReturnPathTest();
  });

  it("H4b a later 401 that carried the old bearer keeps the stored wall URL", () => {
    runLater401WithTheOldBearerKeepsReturnPathTest();
  });

  it("adds the bearer token without discarding the caller's headers", () => {
    runWithAuthTests();
  });
});

describe("F4.203 api/http keeps the first auth-failure reason", () => {
  it("R1 a deactivated 401 records account_deactivated", async () => {
    await runDeactivated401RecordsTheReason();
  });

  it("R2 a plain 401 records no reason", async () => {
    await runPlain401RecordsNoReason();
  });

  it("R3 a later plain 401 does not erase the reason", async () => {
    await runALaterPlain401DoesNotEraseTheReason();
  });

  it("R3b the store keeps the first reason", () => {
    runTheStoreKeepsTheFirstReason();
  });

  it("R4 a non-JSON 401 body is ignored", async () => {
    await runANonJsonBodyIsIgnored();
  });

  it("R5 the caller can still read the body", async () => {
    await runTheCallerCanStillReadTheBody();
  });

  it("R6 a 401 with a used body still clears the session", async () => {
    await runAReadBodyStillClearsTheSession();
  });

  it("R8 a 401 whose clone throws still clears the session", async () => {
    await runAnUnclonableResponseStillClearsTheSession();
  });

  it("R7 setSession consumes the reason", async () => {
    await runSetSessionConsumesTheReason();
  });
});

describe("F4.206 a 401 clears the session only when it carried the current bearer", () => {
  it("L1 a late 401 for an old token leaves the new session", () => {
    runALate401LeavesTheNewSession();
  });

  it("L2 a late 401 for an old token records no reason", async () => {
    await runALate401RecordsNoReason();
  });

  it("L3 control: a 401 that carried the current token still clears and records", async () => {
    await runACurrent401StillClearsAndRecords();
  });

  it("L4 a 401 whose request carried no bearer leaves a later session", () => {
    runAnAnonymous401LeavesALaterSession();
  });

  it("L5 a stale 401 on a wall URL stores no return path", () => {
    runAStale401StoresNoReturnPath();
  });
});

describe("F4.219 a 401 reason is dropped when a session is set during the body read", () => {
  it("S1 a session set during the 401 body read records no reason", async () => {
    await runASessionSetDuringThe401BodyReadRecordsNothing();
  });

  it("S2 control: a streamed 401 body with no new session records the reason", async () => {
    await runAStreamed401BodyWithNoNewSessionRecordsTheReason();
  });
});
