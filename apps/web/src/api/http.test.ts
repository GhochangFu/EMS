// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
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
