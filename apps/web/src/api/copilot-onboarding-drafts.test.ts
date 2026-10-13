import { afterEach, describe, it, vi } from "vitest";

import {
  aResumeSendsTheSessionId,
  aStartSendsNoSessionIdKey,
  theDraftListReadsTheOrganizationRoute,
  theHomeDraftListSendsNoQueryString,
  theDraftListRefusesAnItemThatCarriesTheDraft,
} from "./copilot-onboarding-drafts.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). No
 * `@vitest-environment` docblock: the project default `node` is enough.
 */
describe("F4.255 PR 3 — the draft list and the resume clients", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the draft list reads GET /admin/onboarding/sessions?organizationId=", theDraftListReadsTheOrganizationRoute);
  it("the home draft list reads GET /admin/onboarding/sessions with no query string", theHomeDraftListSendsNoQueryString);
  it("the draft list refuses an item that carries the draft", theDraftListRefusesAnItemThatCarriesTheDraft);
  it("a start sends no sessionId key", aStartSendsNoSessionIdKey);
  it("a resume sends the organization and the session id", aResumeSendsTheSessionId);
});
