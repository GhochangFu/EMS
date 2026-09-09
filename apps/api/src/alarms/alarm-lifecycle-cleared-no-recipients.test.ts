import { describe, it } from "vitest";

import {
  assertEveryRecipientDisabledIsWarnedNotSilent,
  assertNeitherWarnLeaksAlarmTextOrRecipients,
  assertNoSentRowIsWarnedNotSilent,
  assertTheClearItselfIsUnaffectedAtBothReturns,
  assertTheTwoWarnsAreDistinguishable,
} from "./alarm-lifecycle-cleared-no-recipients.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per numbered assertion, by `F4.105`: `assert` throws, so a single
 * `it()` over five cases stops at the first failure and every later block is
 * decoration a mutation can never redden.
 */
describe("alarm lifecycle: a cleared message that reaches nobody", () => {
  it("warns when no channel holds a sent row for the alarm", async () => {
    await assertNoSentRowIsWarnedNotSilent();
  });

  it("warns when every channel that holds a sent row is disabled", async () => {
    await assertEveryRecipientDisabledIsWarnedNotSilent();
  });

  it("makes the two cases distinguishable in the log", async () => {
    await assertTheTwoWarnsAreDistinguishable();
  });

  it("keeps the alarm text, the recipients and their configuration out of both warns", async () => {
    await assertNeitherWarnLeaksAlarmTextOrRecipients();
  });

  it("leaves the clear itself, and the absence of a delivery row, unchanged at both returns", async () => {
    await assertTheClearItselfIsUnaffectedAtBothReturns();
  });
});
