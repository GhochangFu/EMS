import { describe, it } from "vitest";

import {
  assertNotifyOnRaiseIsFireAndForget,
  assertShouldNotifyReadsOnlyTheNotifyType,
  assertToDispatchInputMapsFieldForField,
  assertUntilFailsLoudly,
} from "./rule-actions.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.7 rule actions", () => {
  it("shouldNotify is true for notify only, through asAction's narrowing", () => {
    assertShouldNotifyReadsOnlyTheNotifyType();
  });

  it("toDispatchInput maps the rule and the raise result field for field", () => {
    assertToDispatchInputMapsFieldForField();
  });

  it("notifyOnRaise dispatches fire-and-forget, warns on a rejection, and never throws", async () => {
    await assertNotifyOnRaiseIsFireAndForget();
  });

  it("until polls to the condition and fails loudly on timeout", async () => {
    await assertUntilFailsLoudly();
  });
});
