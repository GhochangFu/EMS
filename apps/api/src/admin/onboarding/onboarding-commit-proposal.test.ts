import { describe, it } from "vitest";

import {
  assertCommitSummaryIsBoundedAndCodeWritten,
  assertSummaryNamesTheKeysNewToTheCatalog,
  assertConfirmPhraseIsExact,
  assertDraftHashChangesWithSecrets,
  assertDraftHashExcludesTheProposalItself,
  assertDraftHashIgnoresKeyOrder,
  assertDraftHashRefusesADeepDraft,
  assertReadCommitProposalFailsClosed,
  assertRedactDraftForClientDropsTheCommitProposal,
  assertRedactDraftForLlmDropsTheCommitProposal,
  assertW11AddingATemplateChangesTheHash,
} from "./onboarding-commit-proposal.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("onboarding commit proposal (F3.21, ADR 0090 decision 5)", () => {
  it("matches the confirm phrase exactly", () => {
    assertConfirmPhraseIsExact();
  });

  it("hashes a draft independently of key order", () => {
    assertDraftHashIgnoresKeyOrder();
  });

  it("changes the hash when a credential is set", () => {
    assertDraftHashChangesWithSecrets();
  });

  it("keeps the proposal outside its own hash", () => {
    assertDraftHashExcludesTheProposalItself();
  });

  it("refuses to hash a draft past the depth bound", () => {
    assertDraftHashRefusesADeepDraft();
  });

  it("reads a malformed stored proposal as none", () => {
    assertReadCommitProposalFailsClosed();
  });

  it("writes a bounded summary from the draft", () => {
    assertCommitSummaryIsBoundedAndCodeWritten();
  });

  it("names the point keys new to the catalog in the summary", () => {
    assertSummaryNamesTheKeysNewToTheCatalog();
  });

  it("drops the proposal from the client view", () => {
    assertRedactDraftForClientDropsTheCommitProposal();
  });

  it("drops the proposal from the LLM view", () => {
    assertRedactDraftForLlmDropsTheCommitProposal();
  });
});

describe("draftHash — templates (F3.22)", () => {
  it("W11 changes when a template is added", () => {
    assertW11AddingATemplateChangesTheHash();
  });
});
