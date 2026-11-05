import { describe, it } from "vitest";

import {
  theDomainSentenceNamesBothDomains,
  theOrganizationSentenceNamesTheAssetAndTheVersion,
  thePinnedSentenceNamesTheAssetAndTheVersion,
} from "./asset-templates-adopt-messages.spec";

/** `F4.315` PR A — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.315 PR A — the shared adoption refusal sentences (ADR 0099 Amendment 14 decision 2)", () => {
  it("names the asset and the version in the pinned sentence", () => thePinnedSentenceNamesTheAssetAndTheVersion());
  it("names the asset and the version in the organization sentence", () => theOrganizationSentenceNamesTheAssetAndTheVersion());
  it("names the asset, the version and both domains in the domain sentence", () => theDomainSentenceNamesBothDomains());
});
