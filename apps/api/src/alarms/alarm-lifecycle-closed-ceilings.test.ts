import { describe, it } from "vitest";

import {
  assertOneCeilingReadPerTickAndAgainNextTick,
  assertOneMemoPerTickSharedByBothPhases,
  assertTheClearedMessageIsHandedNoMemo,
} from "./alarm-lifecycle-closed-ceilings.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, never one over the three: `assert` throws, so a mutation
 * inside a shared block reddens whichever case runs first and the block that
 * owns the claim never runs (AGENTS.md §4.6). Each mutation in the spec's
 * docblocks names the case it must redden, and that is only measurable in this
 * shape.
 */
describe("F3.53 the sweep owns the memo for the length of one tick", () => {
  it("pays one ceiling read for a tick's refused steps on one channel, and asks again next tick", async () => {
    await assertOneCeilingReadPerTickAndAgainNextTick();
  });

  it("hands both re-offering phases one instance, and a different one every tick", async () => {
    await assertOneMemoPerTickSharedByBothPhases();
  });

  it("hands the cleared message no memo at all", async () => {
    await assertTheClearedMessageIsHandedNoMemo();
  });
});
