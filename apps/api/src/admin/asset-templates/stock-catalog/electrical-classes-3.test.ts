import { describe, it } from "vitest";

import {
  assertDialectsV2ThenV3,
  assertFormulaPinned,
  assertKwhTodayStillMeasured,
  assertMaxInputAgeDefault,
  assertMinCoverageRatioNull,
  assertNineDerivedRowsInOrder,
  assertNotRequiredNoMeta,
  assertParamRefsAreVocabulary,
  assertParamRefsControl,
  assertScheduledAt60,
  assertSortOrder36To41,
  assertStockVersion3,
  assertUnitsPerPlan,
  E41C_FEEDER_FORMULAS,
  e41cElectricalClaims,
  runFeederTagListBlock,
} from "./electrical-classes-3.spec";

/**
 * Vitest entry point for `electrical-classes-3.spec.ts` — assertions live in
 * the `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires
 * the wrapper to be its **name-sibling** (see `electrical-classes.test.ts`).
 *
 * One `it()` per claim: `assert` throws, so only the first failure in a block
 * is reported, and a later claim never runs. The moved `F2.13` block keeps its
 * one-block shape; `E4.1c`'s claims are split.
 */
describe("stock asset-template catalog — the feeder class (F2.13 §1, F2.8, E4.1c)", () => {
  it("matches tag list §1 and carries F2.8's three v2 rows first (the block moved from stock-catalog.spec.ts)", () => {
    runFeederTagListBlock();
  });

  it("E4.1c — nine derived rows, in sortOrder order: site_kw, it_kw, pue, then the six", () => {
    assertNineDerivedRowsInOrder();
  });

  it("E4.1c — the six sit at sortOrder 36–41", () => {
    assertSortOrder36To41();
  });

  it("E4.1c — dialects are v2, v2, v2 then v3 × 6", () => {
    assertDialectsV2ThenV3();
  });

  for (const [pointKey, formula] of E41C_FEEDER_FORMULAS) {
    it(`E4.1c — ${pointKey} is exactly "${formula}"`, () => {
      assertFormulaPinned(pointKey);
    });
  }

  it("E4.1c — units per plan §3.7 (money is the empty string, Q8)", () => {
    assertUnitsPerPlan();
  });

  it("E4.1c — every row is scheduled at 60 s", () => {
    assertScheduledAt60();
  });

  it("E4.1c — every row leaves minCoverageRatio at derived()'s null (inert — no @scope aggregate)", () => {
    assertMinCoverageRatioNull();
  });

  it("E4.1c — every row takes the default input age", () => {
    assertMaxInputAgeDefault();
  });

  it("E4.1c — every row is required: false with no meta", () => {
    assertNotRequiredNoMeta();
  });

  it("E4.1c — the control: an unknown $key is reported by the parser", () => {
    assertParamRefsControl();
  });

  it("E4.1c — every $key is one of 0074's twelve; every formula parses under v3 within MAX_FORMULA_WINDOWS", () => {
    assertParamRefsAreVocabulary();
  });

  it("E4.1c — kwh_today stays required and measured (Q3)", () => {
    assertKwhTodayStillMeasured();
  });

  it("E4.1c — stockVersion is 3 (ruling 10)", () => {
    assertStockVersion3();
  });

  // The transformer, DG set, solar PV and APFC rows — one it() per claim.
  for (const [name, run] of e41cElectricalClaims()) {
    it(name, run);
  }
});
