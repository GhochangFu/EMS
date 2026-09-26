import { describe, it } from "vitest";

import {
  assertEmptySourceListResolvesToNone,
  assertFirstYieldingSourceWins,
  assertNoYieldFallsBackToLastNotFirst,
  assertNoYieldFallsBackToNoneUnprobed,
  assertSingleSourceListCostsZeroProbes,
  assertWalkStopsAtFirstYield,
  runAccessScopeTests,
} from "./access-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("access-scope", () => {
  it("gives operator and viewer a grant-backed read scope", () => {
    runAccessScopeTests();
  });
});

/** `F4.161` U1 — `selectReadScopeSource`, the one source-selection walk. */
describe("selectReadScopeSource", () => {
  it("P1 — the first source that yields wins, not the last", async () => {
    await assertFirstYieldingSourceWins();
  });

  it("P2 — no yield falls back to \"none\", unprobed", async () => {
    await assertNoYieldFallsBackToNoneUnprobed();
  });

  it("P3 — no yield falls back to the last source, not the first", async () => {
    await assertNoYieldFallsBackToLastNotFirst();
  });

  it("P4 — a single-source list costs zero probes", async () => {
    await assertSingleSourceListCostsZeroProbes();
  });

  it("P5 — the walk stops at the first source that yields", async () => {
    await assertWalkStopsAtFirstYield();
  });

  it("P6 — an empty source list resolves to \"none\"", async () => {
    await assertEmptySourceListResolvesToNone();
  });
});
