import { describe, it } from "vitest";

import {
  aChangedAddedOrReorderedRowMovesTheBatchHash,
  aNestedClientOnlyPathIsStripped,
  aNonObjectBodyIsHashedWhole,
  anEmptyBodyHashesToTheBracesLiteral,
  clientOnlyKeysAreStripped,
  theBatchHashLeavesOutExcludedRowsAndChecks,
  theVectorHashesToTheSharedLiteral,
} from "./body-hash.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the copilot body hash, API side (ADR 0099 drafter choice 5)", () => {
  it("hashes the fixed vector to the shared literal", () => theVectorHashesToTheSharedLiteral());
  it("hashes an empty body to the braces literal", () => anEmptyBodyHashesToTheBracesLiteral());
  it("strips clientOnly keys before hashing", () => clientOnlyKeysAreStripped());
  it("hashes a non-object body whole", () => aNonObjectBodyIsHashedWhole());
  it("strips a nested clientOnly path before hashing", () => aNestedClientOnlyPathIsStripped());
});

/** `F4.289` — the batch card's hash (ADR 0099 Amendment 9 E3). */
describe("F4.289 — the hash binds the proposed rows alone", () => {
  it("excludedRows and checks leave the batch hash", () => theBatchHashLeavesOutExcludedRowsAndChecks());
  it("a changed, added or reordered row moves the batch hash", () => aChangedAddedOrReorderedRowMovesTheBatchHash());
});
