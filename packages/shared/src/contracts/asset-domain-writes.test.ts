import { describe, it } from "vitest";

import {
  theDomainBodyIsThePrefixOnly,
  theDomainListRoundTrips,
  theTemplateCreateBodyTakesAPrefix,
  theTemplateDtoCarriesThePrefix,
  theTemplateUpdateBodyTakesAPrefix,
} from "./asset-domain-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — the work-order prefix as it is written (ADR 0122 decisions 2.4 and 2.5)", () => {
  it("the domain PATCH body is the prefix only, required and nullable", () => theDomainBodyIsThePrefixOnly());
  it("the admin domain list round-trips, prefix required on each row", () => theDomainListRoundTrips());
  it("the template create body takes an optional prefix", () => theTemplateCreateBodyTakesAPrefix());
  it("the template update body changes, clears or keeps the prefix", () => theTemplateUpdateBodyTakesAPrefix());
  it("the template DTO carries the prefix", () => theTemplateDtoCarriesThePrefix());
});
