import { describe, it } from "vitest";

import {
  aNamedRefusalIsStoredWithItsOrganization,
  anOrganizationRefusalIsStoredWithBothOrganizations,
  aRefusalOutsideTheAllowedSetIsTheOutOfScopeError,
  theModelReadsTheSentence,
} from "./copilot-turn.refusal-provenance.spec";

/** `F4.315` PR A review — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.315 PR A — a named refusal's provenance (ADR 0099 decision 10)", () => {
  it("stores a named refusal with its organization", () => aNamedRefusalIsStoredWithItsOrganization());
  it("stores an organization refusal with both organizations", () => anOrganizationRefusalIsStoredWithBothOrganizations());
  it("lets the model read the refusal's sentence", () => theModelReadsTheSentence());
  it("answers a refusal naming an organization outside the allowed set with the out-of-scope error", () =>
    aRefusalOutsideTheAllowedSetIsTheOutOfScopeError());
});
