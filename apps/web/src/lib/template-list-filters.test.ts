import { describe, it } from "vitest";

import {
  runClampDropsAValueWithNoOptionTests,
  runDomainFollowsLatestVersionTests,
  runDomainOptionsOrderedByVocabularyTests,
  runEmptyFilterKeepsEverythingTests,
  runFiltersByOrganizationAndDomainTests,
  runOrganizationOptionsTests,
  runSubtitleTests,
  runUndefinedVocabularyFallsBackToCodeTests,
  runUnknownDomainStillOfferedTests,
} from "./template-list-filters.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template list filters", () => {
  it("keeps every group, in order, when neither filter is set", () => {
    runEmptyFilterKeepsEverythingTests();
  });

  it("filters by organization and by domain, intersecting when both are set", () => {
    runFiltersByOrganizationAndDomainTests();
  });

  it("filters a template by its latest version's domain, without splitting it in two", () => {
    runDomainFollowsLatestVersionTests();
  });

  it("offers only the organizations present, sorted by code and deduplicated", () => {
    runOrganizationOptionsTests();
  });

  it("offers only the domains present, in the vocabulary's sortOrder", () => {
    runDomainOptionsOrderedByVocabularyTests();
  });

  it("still offers a domain the vocabulary does not carry, labelled by its code, sorted last", () => {
    runUnknownDomainStillOfferedTests();
  });

  it("orders and labels by code when the vocabulary has not loaded", () => {
    runUndefinedVocabularyFallsBackToCodeTests();
  });

  it("says 'showing x of y' only while a filter hides something", () => {
    runSubtitleTests();
  });

  it("drops a filter whose option has gone, so the control cannot lie about the list", () => {
    runClampDropsAValueWithNoOptionTests();
  });
});
