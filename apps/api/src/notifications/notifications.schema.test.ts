import { describe, it } from "vitest";

import {
  testAMixedPatchBodyIsRefusedAndNamesTheKey,
  testAnEmptyPatchIsStillRefusedByItsOwnRule,
  testAPatchCannotSmuggleTheChannelCode,
  testAValidPatchStillParses,
  testCreateRefusesAnUnknownKey,
  testSetRuleNotificationsRefusesAnUnknownKey,
  testStrictDoesNotReachInsideTheConfigRecord,
} from "./notifications.schema.spec";

/**
 * `E7.1f` — Vitest entry point. Assertions live in the sibling `.spec` (§4.6).
 */
describe("E7.1f — notification channel bodies refuse an unknown key", () => {
  it("refuses a mixed PATCH and names the smuggled key", () => {
    testAMixedPatchBodyIsRefusedAndNamesTheKey();
  });

  it("refuses a PATCH carrying the channel code", () => {
    testAPatchCannotSmuggleTheChannelCode();
  });

  it("still refuses an empty PATCH with the refinement's own message", () => {
    testAnEmptyPatchIsStillRefusedByItsOwnRule();
  });

  it("still accepts a PATCH of one declared field", () => {
    testAValidPatchStillParses();
  });

  it("refuses an undeclared key on create, and still accepts organizationId", () => {
    testCreateRefusesAnUnknownKey();
  });

  it("refuses an undeclared key on the rule-notification join", () => {
    testSetRuleNotificationsRefusesAnUnknownKey();
  });

  it("leaves the config record open", () => {
    testStrictDoesNotReachInsideTheConfigRecord();
  });
});
