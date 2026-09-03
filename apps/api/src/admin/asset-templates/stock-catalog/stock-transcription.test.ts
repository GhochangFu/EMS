import { describe, it } from "vitest";

import { runStockTranscriptionSelfTests } from "./stock-transcription.spec";

/**
 * Vitest entry point for `stock-transcription.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014).
 *
 * **This wrapper runs real claims, and that is the whole reason the helpers
 * live in a `.spec.ts` rather than a plain module.** A helpers-only spec whose
 * wrapper called nothing would satisfy `tests/repo-invariants.test.ts` by name
 * while executing zero assertions — the dead-artefact shape that invariant
 * exists to refuse. `runStockTranscriptionSelfTests()` holds three negative
 * self-tests, each with a positive control: the `0034` skill vocabulary, the
 * partition clause `E5.1` §13 item 7 added without a test proving it can fire,
 * and the U+00B5 / U+03BC unit comparison the `E5.1` code reviewer ran by hand.
 */
describe("stock asset-template catalog — the transcription helpers (E5.2 Task 2)", () => {
  it("refuses a wrong skill vocabulary, a non-partitioning skill list and a mu-spelled unit", () => {
    runStockTranscriptionSelfTests();
  });
});
