import { describe, it } from "vitest";

import {
  aCalculatedRowIsADerivedFormulaPoint,
  aCompleteDraftIsTheBodyTheSchemaParses,
  aMissingIntervalIsNamedWithoutAnInheritanceClause,
  aNewDraftOpensOnAGrammarAndATriggerNeverOnEmpty,
  aNonIntegerBackfillFromAFillReadsAsNone,
  aTemplatedAssetIsExcludedFromTheBatch,
  anEditOpensOnWhatThePointRuns,
  anUnknownKeyIsRefusedNamingThisAsset,
  anyOtherErrorYieldsNoRefusals,
  aUsableDraftHasNoProblems,
  emptyFieldsAreAbsentButAnEmptyIntervalIsNull,
  fieldsRoundTripThroughTheBody,
  knownRefsMirrorTheServersRuleThree,
  theBatchRefusalBodyYieldsEveryRefusedAsset,
  theCapSentenceAppearsOnlyAboveTheCap,
  theStandInConfigParsesAsAStandaloneItem,
} from "./calc-point-draft.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 PR 6a — the standalone calculated point's draft and batch rules", () => {
  it("a new draft opens on a grammar and a trigger, never on empty", () => {
    aNewDraftOpensOnAGrammarAndATriggerNeverOnEmpty();
  });

  it("a complete draft is the body calcPointSetBodySchema parses", () => {
    aCompleteDraftIsTheBodyTheSchemaParses();
  });

  it("an empty field is absent, but an empty interval is null", () => {
    emptyFieldsAreAbsentButAnEmptyIntervalIsNull();
  });

  it("an edit opens on what the point runs", () => {
    anEditOpensOnWhatThePointRuns();
  });

  it("a draft round-trips through the body", () => {
    fieldsRoundTripThroughTheBody();
  });

  it("a non-integer backfill from a fill reads as none", () => {
    aNonIntegerBackfillFromAFillReadsAsNone();
  });

  it("the known keys mirror the server's rule 3", () => {
    knownRefsMirrorTheServersRuleThree();
  });

  it("a calculated row is a derived point to the formula editor", () => {
    aCalculatedRowIsADerivedFormulaPoint();
  });

  it("a usable draft has no problems", () => {
    aUsableDraftHasNoProblems();
  });

  it("an unknown key is refused, naming this asset as the declarer", () => {
    anUnknownKeyIsRefusedNamingThisAsset();
  });

  it("a missing interval is named without an inheritance clause", () => {
    aMissingIntervalIsNamedWithoutAnInheritanceClause();
  });

  it("the Add form's stand-in config parses as a standalone item", () => {
    theStandInConfigParsesAsAStandaloneItem();
  });

  it("a selected asset with a template is excluded from the batch", () => {
    aTemplatedAssetIsExcludedFromTheBatch();
  });

  it("the cap sentence appears only above the cap", () => {
    theCapSentenceAppearsOnlyAboveTheCap();
  });

  it("the batch's 400 yields every refused asset", () => {
    theBatchRefusalBodyYieldsEveryRefusedAsset();
  });

  it("any other error yields no refusals", () => {
    anyOtherErrorYieldsNoRefusals();
  });
});
