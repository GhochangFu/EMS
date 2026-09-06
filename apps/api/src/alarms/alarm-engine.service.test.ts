import { describe, it } from "vitest";

import {
  assertANonTransitionDispatchesNothing,
  assertARejectedDispatchDoesNotAbortTheBatch,
  assertDispatchesOnlyForTheNotifyRule,
} from "./alarm-engine.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.7 — the streaming alarm engine's notify decision", () => {
  it("dispatches for the notify rule only, though both rules in the batch raised", async () => {
    await assertDispatchesOnlyForTheNotifyRule();
  });

  it("dispatches nothing when the raise opened no alarm (owner ruling Q2)", async () => {
    await assertANonTransitionDispatchesNothing();
  });

  it("keeps evaluating the batch when a dispatch rejects", async () => {
    await assertARejectedDispatchDoesNotAbortTheBatch();
  });
});
