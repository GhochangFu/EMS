import { describe, it } from "vitest";

import {
  aMissingOrganizationIsA400,
  aNonUuidIsA400,
  aUuidReachesTheList,
  theHandlerIsMountedAtGetSessions,
  theOrganizationComesFromTheOrganizationIdQueryKey,
} from "./onboarding-list-route.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.255 — GET /admin/onboarding/sessions (ADR 0099 Amendment 2 A1)", () => {
  it("hands a uuid organization to listDrafts", () => aUuidReachesTheList());
  it("answers 400 for a non-uuid organization id", () => aNonUuidIsA400());
  it("answers 400 for a missing organization id", () => aMissingOrganizationIsA400());
  it("is mounted at GET sessions", () => theHandlerIsMountedAtGetSessions());
  it("reads the organization from the organizationId query key", () =>
    theOrganizationComesFromTheOrganizationIdQueryKey());
});
