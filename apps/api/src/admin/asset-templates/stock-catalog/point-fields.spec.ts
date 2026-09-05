import { describe, expect, it } from "vitest";

import { derived } from "./point-fields";

/**
 * `F2.9` Task 8 — `derived()`'s two overloads (ADR 0055 decision 10).
 *
 * The runtime assertions prove the values each overload produces; the
 * `@ts-expect-error` lines below prove the type-level guarantee the docblock
 * on `derived()` claims — each **fails the build if the error stops
 * occurring**, so a loosened overload cannot pass CI silently. Registered by
 * `point-fields.test.ts` (ADR 0014).
 */
export function runPointFieldsTests(): void {
  it("the plain call stays v1 streaming with a null interval and no coverage ratio", () => {
    const point = derived("{a}");
    expect(point.kind).toBe("derived");
    expect(point.calcTrigger).toBe("streaming");
    expect(point.calcIntervalSeconds).toBeNull();
    expect(point.formulaDialect).toBe("bms-calc-v1");
    expect(point.minCoverageRatio).toBeNull();
    expect(point.maxInputAgeSeconds).toBeNull();
    expect(point.sourceDataKeyPattern).toBeNull();
    expect(point.formula).toBe("{a}");
  });

  it("the scheduled overload carries the v2 dialect, the interval, and the coverage ratio", () => {
    // Deliberately not @site / cross-asset syntax: tests/adr-0055-calc-v2-
    // invariants.test.ts part (b) scans every call to this file's own
    // `derived` function for its formula-string argument, under this whole
    // directory — .spec.ts included, no exemption — and asserts it parses
    // identically under v1 and v2. A real cross-asset formula wouldn't; this
    // is a plumbing test for the fields derived() attaches, not a calc-DSL
    // test, so a plain formula proves the same thing without colliding with
    // that scan (found at this task's build gate).
    const point = derived("{kw} * 2", {
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      formulaDialect: "bms-calc-v2",
      minCoverageRatio: 0.8,
    });
    expect(point.kind).toBe("derived");
    expect(point.calcTrigger).toBe("scheduled");
    expect(point.calcIntervalSeconds).toBe(60);
    expect(point.formulaDialect).toBe("bms-calc-v2");
    expect(point.minCoverageRatio).toBe(0.8);
    expect(point.maxInputAgeSeconds).toBeNull();
    expect(point.sourceDataKeyPattern).toBeNull();
    expect(point.formula).toBe("{kw} * 2");
  });
}

// ---- type-level guarantees --------------------------------------------

// @ts-expect-error `calcIntervalSeconds` without `calcTrigger: "scheduled"`
// must not compile — the plain overload accepts only `maxInputAgeSeconds`.
const withIntervalButNoTrigger = derived("{a}", { calcIntervalSeconds: 60 });

// @ts-expect-error `formulaDialect: "bms-calc-v2"` without
// `calcTrigger: "scheduled"` must not compile — a `v2` formula must be
// scheduled (ADR 0055 decision 10), and the plain overload has no way to say
// `formulaDialect` at all.
const withV2ButNoTrigger = derived("{a}", { formulaDialect: "bms-calc-v2" });

describe("point-fields type-level fixtures are constructible", () => {
  it("both @ts-expect-error fixtures still evaluate at runtime", () => {
    // `never` at the type level (no overload matches, so TS intersects the
    // two candidate return types) — only reference, no member access.
    expect(withIntervalButNoTrigger).toBeDefined();
    expect(withV2ButNoTrigger).toBeDefined();
  });
});
