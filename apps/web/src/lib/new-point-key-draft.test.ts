import { describe, it } from "vitest";

import {
  a400Or422IsStillReportedAsNotWritten,
  aBackfillRunning409IsNotReportedAsNotWritten,
  aCodeTheAssetAlreadyHasIsAClash,
  aNoWorker503IsNotReportedAsNotWritten,
  aCodeOutsideTheCatalogClassIsRefused,
  aCompleteDraftHasNoProblem,
  aRefusedCreateWritesNoPoint,
  aRefusedPointAfterTheKeyThrowsTheTwoWriteError,
  aTakenCodeContinuesToThePoint,
  aTypedUnitIsSent,
  aUnitLongerThanTheSchemaAllowsIsRefused,
  anEmptyDraftNamesTheCodeAndTheLabel,
  onlyA409IsAlreadyExists,
  theBatchCheckRefusesOnlyTheAssetThatLacksAReference,
  theBatchRefusalSentenceSaysNoKeyWasWritten,
  theBodyTrimsAndLeavesABlankUnitAbsent,
  theKeyIsCreatedBeforeThePointIsWritten,
  thePointCauseIsTheServersError,
  theSentinelIsNoCatalogCode,
  theTwoWriteErrorCarriesTheServersSentence,
  theTwoWriteSentenceIsThePlansWords,
  withNoNewKeyOnlyThePointIsWritten,
} from "./new-point-key-draft.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.313 — New key: the draft, its checks and the two writes", () => {
  it("the New key sentinel can equal no catalog code", () => {
    theSentinelIsNoCatalogCode();
  });

  it("the create body is trimmed and a blank unit is absent", () => {
    theBodyTrimsAndLeavesABlankUnitAbsent();
  });

  it("a typed unit is sent", () => {
    aTypedUnitIsSent();
  });

  it("a code outside the catalog class is refused in the shared schema's sentence", () => {
    aCodeOutsideTheCatalogClassIsRefused();
  });

  it("an empty draft names the code and the label", () => {
    anEmptyDraftNamesTheCodeAndTheLabel();
  });

  it("a unit longer than the schema allows is refused", () => {
    aUnitLongerThanTheSchemaAllowsIsRefused();
  });

  it("a complete draft has no problem", () => {
    aCompleteDraftHasNoProblem();
  });

  it("only a 409 from the create is \"already exists\"", () => {
    onlyA409IsAlreadyExists();
  });

  it("the two-write sentence is the plan's words", () => {
    theTwoWriteSentenceIsThePlansWords();
  });

  it("the two-write error carries the server's sentence", () => {
    theTwoWriteErrorCarriesTheServersSentence();
  });

  it("a 503 after the key (no worker, point saved) is not reported as not written", () => {
    aNoWorker503IsNotReportedAsNotWritten();
  });

  it("a 409 after the key (backfill running, point saved) is not reported as not written", () => {
    aBackfillRunning409IsNotReportedAsNotWritten();
  });

  it("a 400 or 422 after the key is still reported as not written", () => {
    a400Or422IsStillReportedAsNotWritten();
  });

  it("a code the asset already has is a clash", () => {
    aCodeTheAssetAlreadyHasIsAClash();
  });

  it("the point cause is the server's own error", () => {
    thePointCauseIsTheServersError();
  });

  it("with no new key only the point is written", async () => {
    await withNoNewKeyOnlyThePointIsWritten();
  });

  it("the key is created before the point is written", async () => {
    await theKeyIsCreatedBeforeThePointIsWritten();
  });

  it("a taken code (409) continues to the point write", async () => {
    await aTakenCodeContinuesToThePoint();
  });

  it("a create refused for another reason writes no point", async () => {
    await aRefusedCreateWritesNoPoint();
  });

  it("a refused point after the key throws the two-write error", async () => {
    await aRefusedPointAfterTheKeyThrowsTheTwoWriteError();
  });

  it("the batch check refuses only the asset that lacks a reference", () => {
    theBatchCheckRefusesOnlyTheAssetThatLacksAReference();
  });

  it("the batch refusal sentence says no key was written", () => {
    theBatchRefusalSentenceSaysNoKeyWasWritten();
  });
});
