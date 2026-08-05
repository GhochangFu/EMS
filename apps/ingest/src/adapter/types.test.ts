import { describe, expect, it } from "vitest";

// `.js` extension: `apps/ingest` is ESM under NodeNext resolution, unlike
// `apps/api`, where the specs import extensionless. TypeScript maps it back to
// the `.ts` source at compile time.
import { typeLevelFixtures } from "./types.spec.js";

/**
 * Vitest entry point (ADR 0014). The real assertions in the sibling `.spec` are
 * `@ts-expect-error` directives, enforced by `pnpm typecheck` rather than at
 * run time — this wrapper exists so the spec is imported by something, which is
 * what `tests/repo-invariants.test.ts` checks for, and so the fixtures are
 * proven constructible rather than merely type-checked.
 */
describe("ingest adapter contract (ADR 0016 §1)", () => {
  it("admits a complete push adapter and a complete poll adapter", () => {
    const [push, poll] = typeLevelFixtures.adapters;
    expect(push.mode).toBe("push");
    expect(poll.mode).toBe("poll");
  });

  it("carries the factory members the fan-out must implement", () => {
    const { factory } = typeLevelFixtures;
    expect(factory.protocol).toBe("mqtt");
    // `endpointKey` is the grouping decision ADR 0016 §7 warns about most.
    expect(factory.endpointKey({}, "rtu-1")).toBe("rtu-1");
    expect(factory.supportsDiscovery).toBeUndefined();
  });
});
