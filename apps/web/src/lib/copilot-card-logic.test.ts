import { describe, it } from "vitest";

import {
  anOnboardingCommitInvalidatesTheDraftList,
  theReviewStepDoesNotAskForAClientOnlyField,
  aCreateHasNoBeforeValues,
  aFillIsTakenOnlyForItsStepsFields,
  anEditShowsBeforeAndAfter,
  aStepIsCheckedAloneAndTheBodyAtReview,
  everyEntryHasInvalidations,
  everyWizardEndsWithReview,
  leavingADirtyWizardAsks,
  longAndStructuredValuesAreShortened,
  theAssetGroupAndPointKeyEntriesInvalidateTheirPages,
  theLayoutEntriesInvalidateTheLayouts,
  changeRowsSkipsTheNamedKeys,
  aChangedFormulaShowsTheNowExpression,
  aChangedStructuredValueIsChanged,
  aFormulaIsPairedByPointKeyNotIndex,
  aKpiExpressionIsPairedByCodeNotIndex,
  aLongValueCarriesItsFullText,
  aNewFormulaSiteHasNoNowValue,
  anEditCarriesTheFullNowValueToo,
  anUnchangedFormulaRowIsNotChanged,
  anUnchangedStructuredValueIsNotChanged,
  aShortValueHasNoFullText,
  aSiteWithoutAnExpressionIsNoRow,
  aFormulaRowWithoutAnIdentityIsLabelledByItsPath,
  aKpiFormulaRowIsLabelledByItsCode,
  aPointAndAKpiWithOneCodeAreLabelledApart,
  aTopLevelFormulaSiteIsOnlyItsFieldRow,
  formulaRowsAreAbsentWithoutFormulas,
  formulaRowsShowEachSiteInFull,
} from "./copilot-card-logic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — Confirm card and wizard logic (ADR 0099 decisions 4, 6)", () => {
  it("invalidates queries for every catalog entry", () => everyEntryHasInvalidations());
  it("an onboarding commit invalidates the dock's draft list (F4.255)", () => anOnboardingCommitInvalidatesTheDraftList());
  it("shows no before values for a create", () => aCreateHasNoBeforeValues());
  it("shows before and after for an edit", () => anEditShowsBeforeAndAfter());
  it("shortens long and structured values", () => longAndStructuredValuesAreShortened());
  it("ends every wizard with Review", () => everyWizardEndsWithReview());
  it("checks a step alone and the body at Review", () => aStepIsCheckedAloneAndTheBodyAtReview());
  it("takes a fill only for its step's fields", () => aFillIsTakenOnlyForItsStepsFields());
  it("asks before leaving a dirty wizard", () => leavingADirtyWizardAsks());
  it("does not ask the Review step for a clientOnly field (F3.86 PR 2)", () => theReviewStepDoesNotAskForAClientOnlyField());
  it("re-reads the asset-group and point-key pages after their changes (F3.86 PR 3c)", () =>
    theAssetGroupAndPointKeyEntriesInvalidateTheirPages());
  it("F3.87 PR 5: re-reads the layouts after a layout change", () => theLayoutEntriesInvalidateTheLayouts());
  it("F3.87 PR 5: skips the named keys in the card's rows", () => changeRowsSkipsTheNamedKeys());
});

describe("F4.246 — the card's full values and formula rows (ADR 0099 §3, owner ruling option C)", () => {
  it("carries a long value's full text beside its summary", () => aLongValueCarriesItsFullText());
  it("carries no full text for a value inside the cut", () => aShortValueHasNoFullText());
  it("carries the Now value's own full text", () => anEditCarriesTheFullNowValueToo());
  it("shows each formula site in full under its issue path", () => formulaRowsShowEachSiteInFull());
  it("formats the Now formula like the proposed one, so an unchanged one is not changed", () =>
    anUnchangedFormulaRowIsNotChanged());
  it("shows a changed formula's Now expression", () => aChangedFormulaShowsTheNowExpression());
  it("pairs a point's formula with the Now point of the same pointKey", () => aFormulaIsPairedByPointKeyNotIndex());
  it("shows a dash for a formula site with no Now point", () => aNewFormulaSiteHasNoNowValue());
  it("pairs a KPI expression with the Now KPI of the same code", () => aKpiExpressionIsPairedByCodeNotIndex());
  it("makes no row for a site without an expression", () => aSiteWithoutAnExpressionIsNoRow());
  it("makes no formula row without formulas", () => formulaRowsAreAbsentWithoutFormulas());
  it("labels a KPI's formula row by its code", () => aKpiFormulaRowIsLabelledByItsCode());
  it("labels a point and a KPI with one code apart", () => aPointAndAKpiWithOneCodeAreLabelledApart());
  it("labels a formula row without an identity by its dotted path", () => aFormulaRowWithoutAnIdentityIsLabelledByItsPath());
  it("makes no second row for a top-level formula site (calcOverride.set)", () => aTopLevelFormulaSiteIsOnlyItsFieldRow());
  it("reads an equal structured value as unchanged, whatever its key order and nulls", () =>
    anUnchangedStructuredValueIsNotChanged());
  it("reads a structured value with one nested difference as changed", () => aChangedStructuredValueIsChanged());
});
