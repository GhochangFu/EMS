import { describe, it } from "vitest";

import {
  testAClosedCeilingIsRememberedAndNotAskedAgain,
  testAThrownReadIsNotRemembered,
  testAnOpenCeilingIsNeverRemembered,
  testTheBudgetIsPartOfTheKey,
  testTheChannelIsPartOfTheKey,
  testTheMemoIsPerInstance,
  testTheOrganizationIsPartOfTheKey,
} from "./closed-ceilings.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, so a mutation can be shown to redden the case that owns
 * it. C1 and C2 are the two halves of ruling 1 and run in separate blocks on
 * purpose: `assert` throws, so a pair inside one block would stop at the first
 * failure, and the block that would never run is the one saying an open ceiling
 * is not remembered.
 */
describe("F3.53 the sweep's memo of closed ceilings", () => {
  it("remembers a closed ceiling and does not ask the ledger again", async () => {
    await testAClosedCeilingIsRememberedAndNotAskedAgain();
  });

  it("never remembers an open ceiling", async () => {
    await testAnOpenCeilingIsNeverRemembered();
  });

  it("keys on the budget, so a raise does not inherit an event's refusal", async () => {
    await testTheBudgetIsPartOfTheKey();
  });

  it("keys on the organization", async () => {
    await testTheOrganizationIsPartOfTheKey();
  });

  it("keys on the channel", async () => {
    await testTheChannelIsPartOfTheKey();
  });

  it("does not remember a read that threw", async () => {
    await testAThrownReadIsNotRemembered();
  });

  it("keeps its memory per instance, not at module level", async () => {
    await testTheMemoIsPerInstance();
  });
});
