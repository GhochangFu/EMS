import { describe, it } from "vitest";

import {
  aBatchProposalStoresTheChecksBesideTheRules,
  aRefusedRowReturnsItsNumberAndStoresNoCard,
  aSecondBatchWhileOneIsOpenIsRefused,
  aTwentySixthRowIsRefusedByTheModelBody,
  everyToolAndEntryTheBatchRuleNamesExists,
  theBatchCheckIsAskedWithTheRowsAndTheResolvedOrganization,
  theBatchHashBindsTheRulesAlone,
  theBatchSummaryCarriesTheLiveLineAndTheNote,
  theBatchRuleNamesTheInventoryAndOneCardAtATime,
  theModelCannotSendExcludedRowsOrChecks,
  thePromptCarriesTheBatchRule,
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

/** `F4.289` Task 9 — the prompt line. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.289 — the prompt routes a site-wide rule request through the inventory", () => {
  it("the prompt carries the batch rule", () => thePromptCarriesTheBatchRule());
  it("the rule names the inventory and one card at a time", () => theBatchRuleNamesTheInventoryAndOneCardAtATime());
  it("every tool and entry the rule names exists", () => everyToolAndEntryTheBatchRuleNamesExists());
});
