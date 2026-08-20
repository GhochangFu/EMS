import { defineProject } from "vitest/config";

/**
 * `@bms/shared` tests (`F2.3`). ADR 0030 gave this package a runtime — the
 * `bms-calc-v1` parser is the first code in it that needs behavioural tests
 * rather than the type-level checks `tests/adr-0030-contract-derivation.test.ts`
 * already runs. Without this project vitest never discovers a `.spec.ts` here,
 * while `tests/repo-invariants.test.ts`'s orphan-spec check walks `packages`
 * too and would go green regardless — a check that runs is not the same as a
 * check that executes the assertions.
 */
export default defineProject({
  test: {
    name: "shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
