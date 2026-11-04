import { describe, it } from "vitest";

import {
  aCalculatedRowIsADerivedFormulaPoint,
  aDoneRunSaysDoneWithItsDaysAndRows,
  aFailedRunShowsItsStoredError,
  aFailedRunWithNoStoredErrorSaysSo,
  aJustFailedRetriableRunIsStillPolled,
  aJustFailedRetriableRunSaysRetrying,
  aJustFailedRunWithNoStoredErrorIsStillPolled,
  anOldFailedRetriableRunIsNotPolled,
  anOldFailedRetriableRunSaysFailed,
  aOneDayDoneRunIsSingular,
  aOneDayRunningRunIsSingular,
  aPartDayCountsOnlyTheWholeDaysStored,
  aQueuedOrRunningItemPollsEveryFiveSeconds,
  aRunNotYetStartedIsQueued,
  aRunningRunCountsDaysFromItsWindowStartAndItsRows,
  aRunningRunWithNoBucketStoredYetIsQueued,
  noActiveRunPollsNever,
  oneRowIsSingular,
  aDraftEqualToItsStartIsUnchanged,
  aFormulaOnlyEditIsAChange,
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
  theDialectIsTheDraftsKnownGrammarElseTheDefault,
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

  it("the dialect is the draft's known grammar, else the default", () => {
    theDialectIsTheDraftsKnownGrammarElseTheDefault();
  });

  it("a draft equal to its starting value is unchanged", () => {
    aDraftEqualToItsStartIsUnchanged();
  });

  it("a formula-only edit is a change", () => {
    aFormulaOnlyEditIsAChange();
  });
});

describe("F4.311 PR 6b — a backfill run's progress line and the list's poll", () => {
  it("a run not yet started is queued", () => {
    aRunNotYetStartedIsQueued();
  });

  it("a running run with no bucket stored yet is queued", () => {
    aRunningRunWithNoBucketStoredYetIsQueued();
  });

  it("a running run counts days from its window start (fromAt, not createdAt) and its rows", () => {
    aRunningRunCountsDaysFromItsWindowStartAndItsRows();
  });

  it("a part day counts only the whole days stored", () => {
    aPartDayCountsOnlyTheWholeDaysStored();
  });

  it("one row is singular", () => {
    oneRowIsSingular();
  });

  it("a done run says done, with its days and rows", () => {
    aDoneRunSaysDoneWithItsDaysAndRows();
  });

  it("a failed run shows its stored error in the server's words", () => {
    aFailedRunShowsItsStoredError();
  });

  it("a 1-day done run says 1 day", () => {
    aOneDayDoneRunIsSingular();
  });

  it("a 1-day running run says 1 day", () => {
    aOneDayRunningRunIsSingular();
  });

  it("a just-failed retriable run says it is retrying", () => {
    aJustFailedRetriableRunSaysRetrying();
  });

  it("a failed retriable run past the retry window says failed", () => {
    anOldFailedRetriableRunSaysFailed();
  });

  it("a failed run with no stored error says so", () => {
    aFailedRunWithNoStoredErrorSaysSo();
  });

  it("a queued or running item polls every five seconds", () => {
    aQueuedOrRunningItemPollsEveryFiveSeconds();
  });

  it("no queued, running or retriable-failed item polls never", () => {
    noActiveRunPollsNever();
  });

  it("a just-failed retriable run is still polled", () => {
    aJustFailedRetriableRunIsStillPolled();
  });

  it("a just-failed run with no stored error is still polled", () => {
    aJustFailedRunWithNoStoredErrorIsStillPolled();
  });

  it("a failed retriable run past the retry window is not polled", () => {
    anOldFailedRetriableRunIsNotPolled();
  });
});
