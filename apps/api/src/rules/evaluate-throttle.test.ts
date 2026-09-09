import { describe, it } from "vitest";

import {
  aGlobalAdminDoesNotDenyAGrantlessCaller,
  aGrantlessCallerDoesNotDenyAGlobalAdmin,
  allowsAPressAtExactlyTheInterval,
  allowsAPressPastTheInterval,
  allowsTheFirstPressOnAFreshInstance,
  consumesEveryBucketAMultiOrganizationCallerBelongsTo,
  doesNotSlideTheWindowForwardOnARefusal,
  givesEveryCallerWithNoOrganizationABucketAnyway,
  holdsTheSameIntervalAsTheAutomaticSweep,
  keepsBothStandInKeysOutOfEveryOrganizationBucket,
  keepsItsWindowsPerInstance,
  keepsOneWindowPerOrganization,
  refusesASecondPressInsideTheWindow,
  refusesTheSecondOfTwoPressesInTheSameTick,
  roundsAPartSecondUpNotDown,
  twoGrantlessCallersDoNotDenyEachOther,
} from "./evaluate-throttle.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * **One `it()` per claim.** These ran as numbered blocks inside a single
 * `it()`, and `assert` throws: the first failing block aborted every later one,
 * so a mutation that reddened the interval left the same-tick race and the
 * bucket claims unreached. A claim that cannot run is decoration.
 */
describe("F3.47 evaluate-now throttle", () => {
  it("keeps its windows per instance, so a restart clears them", () => {
    keepsItsWindowsPerInstance();
  });

  it("allows the first press on a fresh instance", () => {
    allowsTheFirstPressOnAFreshInstance();
  });

  it("refuses a second press inside the window", () => {
    refusesASecondPressInsideTheWindow();
  });

  it("rounds a part second up, so Retry-After is never 0", () => {
    roundsAPartSecondUpNotDown();
  });

  it("allows a press at exactly the interval", () => {
    allowsAPressAtExactlyTheInterval();
  });

  it("allows a press past the interval", () => {
    allowsAPressPastTheInterval();
  });

  it("does not slide the window forward on a refusal", () => {
    doesNotSlideTheWindowForwardOnARefusal();
  });

  it("keeps one window per organization", () => {
    keepsOneWindowPerOrganization();
  });

  it("consumes every bucket a multi-organization caller belongs to", () => {
    consumesEveryBucketAMultiOrganizationCallerBelongsTo();
  });

  it("refuses the second of two presses in the same tick", () => {
    refusesTheSecondOfTwoPressesInTheSameTick();
  });

  it("gives a caller with no organization a bucket rather than no key at all", () => {
    givesEveryCallerWithNoOrganizationABucketAnyway();
  });

  it("does not let a grantless caller deny a global admin", () => {
    aGrantlessCallerDoesNotDenyAGlobalAdmin();
  });

  it("does not let a global admin deny a grantless caller", () => {
    aGlobalAdminDoesNotDenyAGrantlessCaller();
  });

  it("does not let two different grantless callers deny each other", () => {
    twoGrantlessCallersDoNotDenyEachOther();
  });

  it("keeps both stand-in keys out of every organization's bucket", () => {
    keepsBothStandInKeysOutOfEveryOrganizationBucket();
  });

  it("holds the same interval as the automatic sweep", () => {
    holdsTheSameIntervalAsTheAutomaticSweep();
  });
});
