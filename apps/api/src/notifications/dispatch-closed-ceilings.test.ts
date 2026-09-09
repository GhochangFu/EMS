import { describe, it } from "vitest";

import {
  testAFailedReadIsNotRemembered,
  testAnOpenCeilingIsReadBeforeEveryDispatch,
  testAReservedRefusalDoesNotRefuseTheFullBudget,
  testNoThirdArgumentMeansNoMemory,
  testOneStepOverThreeChannelsCostsThreeReads,
  testTheFireAndForgetRaisePathIsUnaffected,
  testTheManualTestPathIsUnaffected,
  testTwoRefusedStepsOnOneChannelCostOneCeilingRead,
} from "./dispatch-closed-ceilings.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, and never one over all eight: `assert` throws, so a
 * mutation inside a shared block reddens the first failing case and the block
 * that owns the claim never runs (AGENTS.md §4.6). Each mutation in the spec's
 * docblocks names the case it must redden, and that is only measurable in this
 * shape.
 */
describe("F3.53 the sweep's memo at the ceiling read", () => {
  it("costs one ceiling read for two refused steps on one channel", async () => {
    await testTwoRefusedStepsOnOneChannelCostOneCeilingRead();
  });

  it("re-reads an open ceiling before every dispatch and remembers nothing", async () => {
    await testAnOpenCeilingIsReadBeforeEveryDispatch();
  });

  it("does not let a reserved refusal refuse a raise on the full budget", async () => {
    await testAReservedRefusalDoesNotRefuseTheFullBudget();
  });

  it("still reads once per channel for one step over three channels", async () => {
    await testOneStepOverThreeChannelsCostsThreeReads();
  });

  it("leaves the fire-and-forget raise path reading the ledger every time", async () => {
    await testTheFireAndForgetRaisePathIsUnaffected();
  });

  it("leaves the manual test path reading the ledger every time", async () => {
    await testTheManualTestPathIsUnaffected();
  });

  it("keeps no memory at all when no memo is passed", async () => {
    await testNoThirdArgumentMeansNoMemory();
  });

  it("does not remember a failed read, and writes no row for the step", async () => {
    await testAFailedReadIsNotRemembered();
  });
});
