import { describe, it } from "vitest";

import {
  anAdoptionOntoADraftReadsTheRoutesSentence,
  anAdoptionOntoAnArchivedVersionReadsTheRoutesSentence,
  anAdoptionOntoAPublishedVersionIsAdmitted,
  aNewDashboardDraftBranchesFromAPublishedVersion,
  anArchiveNeedsAPublishedVersion,
  anEditOfANonDraftIsRefusedWithTheEditSentence,
  anEntryWithoutALifecycleRuleIsNeverRefused,
  anInstantiateNeedsAPublishedVersion,
  aPublishNeedsADraft,
  aRuledEntryWithoutAStatusFailsClosed,
  everyRuledIdIsACatalogEntry,
} from "./copilot-template-lifecycle.spec";

describe("F4.246 — the propose tool's template lifecycle mirror (ADR 0049 decision 2)", () => {
  it("refuses an edit of a non-draft with the route's edit sentence", () => anEditOfANonDraftIsRefusedWithTheEditSentence());
  it("refuses a publish of a non-draft", () => aPublishNeedsADraft());
  it("refuses an archive of a non-published version", () => anArchiveNeedsAPublishedVersion());
  it("refuses a new dashboard draft from a non-published version", () => aNewDashboardDraftBranchesFromAPublishedVersion());
  it("refuses an instantiate of a non-published version with each route's sentence", () =>
    anInstantiateNeedsAPublishedVersion());
  it("admits an adoption onto a published version", () => anAdoptionOntoAPublishedVersionIsAdmitted());
  it("refuses an adoption onto a draft with the adopt route's sentence", () => anAdoptionOntoADraftReadsTheRoutesSentence());
  it("refuses an adoption onto an archived version with the adopt route's sentence", () =>
    anAdoptionOntoAnArchivedVersionReadsTheRoutesSentence());
  it("never refuses an entry whose route holds no status guard", () => anEntryWithoutALifecycleRuleIsNeverRefused());
  it("fails closed on a ruled entry whose target has no status", () => aRuledEntryWithoutAStatusFailsClosed());
  it("rules exactly the ten catalog entries", () => everyRuledIdIsACatalogEntry());
});
