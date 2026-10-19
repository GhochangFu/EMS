import { describe, it } from "vitest";

import {
  assertCredentialExtraKeyIsRefused,
  assertJobIdMatchesTheGrammar,
  assertPayloadWithoutOrganizationIsRefused,
  assertSingleAttempt,
  assertValidPayloadParses,
  assertWindowAboveMaximumIsRefused,
} from "./onboarding-discovery.spec";

/** `F3.24b` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — the onboarding-discovery queue declaration", () => {
  it("parses a valid payload", () => {
    assertValidPayloadParses();
  });

  it("refuses a payload without organizationId", () => {
    assertPayloadWithoutOrganizationIsRefused();
  });

  it("refuses a credential-looking extra key", () => {
    assertCredentialExtraKeyIsRefused();
  });

  it("refuses a window above 120 s", () => {
    assertWindowAboveMaximumIsRefused();
  });

  it("runs one attempt only", () => {
    assertSingleAttempt();
  });

  it("builds a job id that matches JOB_ID_PATTERN", () => {
    assertJobIdMatchesTheGrammar();
  });
});
