import { describe, it } from "vitest";

import {
  assertAPhilosophyAlarmSeedsADisabledRule,
  assertAProtoAlarmSeedsAnArmedRule,
  assertARemovedAlarmReadsAsTemplateMoved,
  assertAnOverflowingCodeIsTruncatedAndHashed,
  assertCodeGetsTheRPrefixWhenItWouldNotStartAlphanumeric,
  assertCodeMatchesTheExistingSeedConvention,
  assertCodeNormalisesCaseSpacesAndPunctuation,
  assertEveryHostileInputStillProducesAValidCode,
  assertNumericAndNullEqualityInTheComparison,
  assertPhilosophyRendersPresentFieldsOnly,
  assertTheActionIsReviewOnTheResolvedCategory,
  assertTheBaselineCarriesTheResolvedValues,
  assertTheConditionOmitsUnitWhenThereIsNone,
  assertTheFourDriftQuadrants,
  assertTheNameIsTruncatedToTheColumnWidth,
  assertThePrefixIsCountedBeforeTheLengthCheck,
  assertTwoAlarmCodesCanDeriveTheSameRuleCode,
} from "./template-alarm-rules.spec";

/** `E2.4` U3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.4 — template alarm rule derivation (ADR 0058)", () => {
  describe("seededRuleCode (decision 7)", () => {
    it("reproduces the existing seed convention's code", () => {
      assertCodeMatchesTheExistingSeedConvention();
    });

    it("uppercases, collapses non-alphanumeric runs and strips the edges", () => {
      assertCodeNormalisesCaseSpacesAndPunctuation();
    });

    it("prefixes R_ when the join would not start alphanumeric", () => {
      assertCodeGetsTheRPrefixWhenItWouldNotStartAlphanumeric();
    });

    it("truncates to 55 and appends an upper-cased hash, landing on exactly 64", () => {
      assertAnOverflowingCodeIsTruncatedAndHashed();
    });

    it("counts the R_ prefix before measuring the length", () => {
      assertThePrefixIsCountedBeforeTheLengthCheck();
    });

    it("produces a code the rule contract accepts for every hostile input", () => {
      assertEveryHostileInputStillProducesAValidCode();
    });

    it("maps two contract-distinct alarm codes onto one rule code, which is why D4 pre-checks", () => {
      assertTwoAlarmCodesCanDeriveTheSameRuleCode();
    });
  });

  describe("philosophyDescription (D1)", () => {
    it("renders the present philosophy fields and null when there are none", () => {
      assertPhilosophyRendersPresentFieldsOnly();
    });
  });

  describe("seededRuleValues (decisions 2, 3, 4, 5)", () => {
    it("seeds a proto-rule enabled, with its operator, threshold and provenance", () => {
      assertAProtoAlarmSeedsAnArmedRule();
    });

    it("seeds a philosophy row disabled, with no limit and its philosophy as the description", () => {
      assertAPhilosophyAlarmSeedsADisabledRule();
    });

    it("writes a review action on the resolved category and joins no channel", () => {
      assertTheActionIsReviewOnTheResolvedCategory();
    });

    it("stores the resolved values in seeded_baseline, and the shared contract parses them", () => {
      assertTheBaselineCarriesTheResolvedValues();
    });

    it("truncates the name to the column width without shortening the baseline message", () => {
      assertTheNameIsTruncatedToTheColumnWidth();
    });

    it("omits condition.unit entirely when no unit was resolved", () => {
      assertTheConditionOmitsUnitWhenThereIsNone();
    });
  });

  describe("driftVerdict (decision 8)", () => {
    it("classifies all four quadrants on all five compared fields", () => {
      assertTheFourDriftQuadrants();
    });

    it("reads a removed alarm as the template having moved", () => {
      assertARemovedAlarmReadsAsTemplateMoved();
    });

    it("compares numbers and nulls by value", () => {
      assertNumericAndNullEqualityInTheComparison();
    });
  });
});
