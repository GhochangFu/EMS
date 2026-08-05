import { describe, it } from "vitest";

import {
  referenceFactory,
  referenceFixtures,
} from "./adapter-contract-meta.spec.js";
import { runAdapterContractTests } from "./adapter-contract.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * This half proves the suite *passes* a conforming adapter; the sibling
 * `adapter-contract-meta.test.ts` proves it *fails* every violation it claims
 * to catch. A gate needs both directions.
 */
describe("adapter conformance suite", () => {
  it("passes a conforming reference adapter", async () => {
    await runAdapterContractTests(referenceFactory, referenceFixtures);
  });
});
