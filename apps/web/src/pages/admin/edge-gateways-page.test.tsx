// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aListErrorIsShown,
  anEmptyListSaysSo,
  aTenantAdminSeesTheStatusLine,
  createSendsTheBody,
  renameSendsTheName,
  revokeAsksFirst,
  theRowsComeFromTheList,
  thePickerIsTheOrganizations,
  theTokenShowsOnce,
} from "./edge-gateways-page.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the Edge Gateways page (plan T6.3)", () => {
  it("E1 fails closed for a tenant admin", aTenantAdminSeesTheStatusLine);
  it("E2 renders the rows, unsynced marked and the backlog shown", theRowsComeFromTheList);
  it("E3 shows a minted token once and forgets it on close", theTokenShowsOnce);
  it("E4 asks before a revoke", revokeAsksFirst);
  it("E5 offers only the gateway's organization in the RTU picker", thePickerIsTheOrganizations);
  it("E6 creates a gateway", createSendsTheBody);
  it("E7 renames a gateway and renders a refusal as a sentence", renameSendsTheName);
  it("E8 says so when there is no gateway, New gateway still offered", anEmptyListSaysSo);
  it("E9 renders a list error as a sentence", aListErrorIsShown);
});
