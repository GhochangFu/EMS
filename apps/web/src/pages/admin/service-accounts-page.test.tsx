// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aNewTokenShowsOnce,
  belowOrganizationAdminIsRefusedAndHasNoTab,
  createSendsTheBodyAndEmptySaysSo,
  disableAsksFirst,
  revokeAsksFirst,
  theAccountsTokensAndGrantsRender,
} from "./service-accounts-page.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.17 — the Service Accounts page (ADR 0125 decision 14)", () => {
  it("S1 fails closed below organization admin, and the tab is the two manager roles' only", belowOrganizationAdminIsRefusedAndHasNoTab);
  it("S2 renders accounts, grants and token ids; a full account offers no new token", theAccountsTokensAndGrantsRender);
  it("S3 shows a new token once and forgets it on close", aNewTokenShowsOnce);
  it("S4 asks before a revoke", revokeAsksFirst);
  it("S5 asks before a disable", disableAsksFirst);
  it("S6 creates an account; an empty list says so", createSendsTheBodyAndEmptySaysSo);
});
