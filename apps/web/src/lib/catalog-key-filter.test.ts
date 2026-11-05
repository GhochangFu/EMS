import { describe, it } from "vitest";

import {
  aKeyWithNoDomainPassesTheDomainFilter,
  sharedDomainOfMixedDomainsIsNull,
  sharedDomainOfNothingIsNull,
  sharedDomainOfOneDomainIsThatDomain,
  theExclusionBeatsTheSelectedKey,
  theSearchMatchesTheCodeTrimmedAndCaseInsensitively,
  theSearchMatchesTheName,
  theSelectedKeyStaysVisible,
} from "./catalog-key-filter.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.313 follow-up — the catalog key picker's list rule", () => {
  it("sharedDomain of no assets is null", () => {
    sharedDomainOfNothingIsNull();
  });

  it("sharedDomain of mixed domains is null", () => {
    sharedDomainOfMixedDomainsIsNull();
  });

  it("sharedDomain of one domain is that domain", () => {
    sharedDomainOfOneDomainIsThatDomain();
  });

  it("the search matches the code, trimmed and case-insensitively", () => {
    theSearchMatchesTheCodeTrimmedAndCaseInsensitively();
  });

  it("the search matches the name", () => {
    theSearchMatchesTheName();
  });

  it("the selected key stays visible under the domain filter", () => {
    theSelectedKeyStaysVisible();
  });

  it("the exclusion beats the selected key", () => {
    theExclusionBeatsTheSelectedKey();
  });

  it("a key with no domain passes the domain filter", () => {
    aKeyWithNoDomainPassesTheDomainFilter();
  });
});
