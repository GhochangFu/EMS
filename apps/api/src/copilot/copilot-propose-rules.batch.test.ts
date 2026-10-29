import { describe, it } from "vitest";

import {
  aBatchProposalStoresTheChecksBesideTheRules,
  aRefusedRowReturnsItsNumberAndStoresNoCard,
  aSecondBatchWhileOneIsOpenIsRefused,
  aTwentySixthRowIsRefusedByTheModelBody,
  theBatchCheckIsAskedWithTheRowsAndTheResolvedOrganization,
  theBatchHashBindsTheRulesAlone,
  theBatchSummaryCarriesTheLiveLineAndTheNote,
  theModelCannotSendExcludedRowsOrChecks,
  twentyFiveRowsAreStored,
} from "./copilot-propose-rules.batch.spec";

/** `F4.289` — Vitest entry point for the batch rule propose path. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.289 — the copilot proposes a batch of alarm rules (ADR 0099 Amendment 9 E3)", () => {
  it("a batch proposal stores the checks beside the rules", () => aBatchProposalStoresTheChecksBesideTheRules());
  it("the batch hash binds the rules alone", () => theBatchHashBindsTheRulesAlone());
  it("the batch summary carries the live line and the note", () => theBatchSummaryCarriesTheLiveLineAndTheNote());
  it("the batch check is asked with the rows and the resolved organization", () =>
    theBatchCheckIsAskedWithTheRowsAndTheResolvedOrganization());
  it("the model cannot send excludedRows or checks", () => theModelCannotSendExcludedRowsOrChecks());
  it("a refused row returns its number and stores no card", () => aRefusedRowReturnsItsNumberAndStoresNoCard());
  it("a twenty-sixth row is refused by the model body", () => aTwentySixthRowIsRefusedByTheModelBody());
  it("twenty-five rows are stored", () => twentyFiveRowsAreStored());
  it("a second batch while one is open is refused", () => aSecondBatchWhileOneIsOpenIsRefused());
});
