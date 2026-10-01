// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
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
