import { describe, it } from "vitest";

import {
  answers403BeforeItEverReachesTheThrottle,
  doesNotResolveTheAssetScopeForARefusedPress,
  keysOnTheOrganizationTheSafeHelperReturned,
  runsNoSweepForARefusedPress,
  saysTheSameWaitInTheHeaderAndTheBody,
  usesTheSingularForAWaitOfOneSecond,
} from "./evaluate-throttle-route.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * **One `it()` per claim.** These ran as numbered blocks inside a single
 * `it()`, and `assert` throws: the first failing block aborted every later one,
 * so a mutation reddened whichever claim came first rather than the one that
 * owns it.
 */
describe("F3.47 evaluate route", () => {
  it("runs no sweep for a press refused inside the window", async () => {
    await runsNoSweepForARefusedPress();
  });

  it("says the same wait in the Retry-After header and in the body", async () => {
    await saysTheSameWaitInTheHeaderAndTheBody();
  });

  it("uses the singular for a wait of one second", async () => {
    await usesTheSingularForAWaitOfOneSecond();
  });

  it("answers 403 before it ever reaches the throttle", async () => {
    await answers403BeforeItEverReachesTheThrottle();
  });

  it("does not resolve the caller's asset scope for a refused press", async () => {
    await doesNotResolveTheAssetScopeForARefusedPress();
  });

  it("keys on the organization readableOrganizationIds returned", async () => {
    await keysOnTheOrganizationTheSafeHelperReturned();
  });
});
