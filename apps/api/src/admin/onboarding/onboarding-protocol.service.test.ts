import { describe, it } from "vitest";

import {
  assertFormatForAssistantKeepsTheOrgExamplesTail,
  assertFormatForAssistantNamesTheFieldsAndTheWiring,
  assertListCatalogReadsNoDatabase,
  assertNoCatalogKeyIsACredentialByTheRealPredicate,
} from "./onboarding-protocol.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24a — OnboardingProtocolService reads the code catalog (ADR 0093 decision 3)", () => {
  it("P1 lists eight protocols without reading the database", async () => {
    await assertListCatalogReadsNoDatabase();
  });

  it("P2 names the fields, discovery and the wiring per protocol", () => {
    assertFormatForAssistantNamesTheFieldsAndTheWiring();
  });

  it("P3 carries no credential by the real predicate", () => {
    assertNoCatalogKeyIsACredentialByTheRealPredicate();
  });

  it("P4 keeps the org-examples line", () => {
    assertFormatForAssistantKeepsTheOrgExamplesTail();
  });
});
